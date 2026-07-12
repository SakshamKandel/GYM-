import { type CoachAssignedWorkoutItem, coachAssignedWorkouts } from '@gym/db';
import { maskPii } from '@gym/shared';
import { asc, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — a client's coach-assigned exercise programs
 * (SCALE-UP-PLAN §4.3). One client can hold several rows (e.g. "Push Day A",
 * "Pull Day B"); `position` orders them on the client's Train tab.
 *
 *  - GET  → all of the client's rows (any status), position asc then
 *           createdAt asc as the tie-break.
 *  - POST {title, notes?, status?, position?, items} → creates one row.
 *          `position` defaults to append-at-end (current row count) when
 *          omitted. Free text the client will read (title, notes, and each
 *          item's name/note/repRange) is PII-masked BEFORE storage — the
 *          in-app-contact policy binds coaches too (mirrors
 *          coach/threads/[userId]/reply's `maskPii(body)` on coach-authored
 *          text).
 *
 * Guards (both verbs, fail closed): requirePermission('coach.user.read' for
 * GET, 'coach.message.user' for POST — the write is content landing in the
 * member's story, same permission milestones/suggestions/flags POST use) +
 * requireCoachOwnsUser(principal, userId) → 403 { error:'forbidden' } when the
 * caller has no ACTIVE assignment over this client (super_admin/main_admin
 * pass without one).
 */

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((v) => v.startsWith('https://'), 'imageUrl must be an https URL');

const workoutItemSchema = z.object({
  exerciseId: z.string().trim().min(1).max(100).nullable(),
  name: z.string().trim().min(1).max(80),
  sets: z.number().int().min(1).max(10),
  repRange: z.string().trim().min(1).max(12),
  restSec: z.number().int().min(15).max(600),
  note: z.string().trim().max(200).optional(),
  imageUrl: httpsUrl.optional(),
});

const postSchema = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  items: z.array(workoutItemSchema).max(15),
});

const workoutColumns = {
  id: coachAssignedWorkouts.id,
  title: coachAssignedWorkouts.title,
  notes: coachAssignedWorkouts.notes,
  position: coachAssignedWorkouts.position,
  status: coachAssignedWorkouts.status,
  items: coachAssignedWorkouts.items,
  createdAt: coachAssignedWorkouts.createdAt,
  updatedAt: coachAssignedWorkouts.updatedAt,
};

/** Masks every client-visible free-text field of one item, in place-safe form. */
function maskItem(item: CoachAssignedWorkoutItem): CoachAssignedWorkoutItem {
  return {
    ...item,
    name: maskPii(item.name),
    repRange: maskPii(item.repRange),
    note: item.note !== undefined ? maskPii(item.note) : undefined,
  };
}

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const workouts = await getDb()
    .select(workoutColumns)
    .from(coachAssignedWorkouts)
    .where(eq(coachAssignedWorkouts.clientId, userId))
    .orderBy(asc(coachAssignedWorkouts.position), asc(coachAssignedWorkouts.createdAt));

  return json({ workouts }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { title, notes, status, position, items } = parsed.data;

  const db = getDb();

  let resolvedPosition = position;
  if (resolvedPosition === undefined) {
    const existing = await db
      .select({ id: coachAssignedWorkouts.id })
      .from(coachAssignedWorkouts)
      .where(eq(coachAssignedWorkouts.clientId, userId));
    resolvedPosition = existing.length;
  }

  const inserted = await db
    .insert(coachAssignedWorkouts)
    .values({
      coachId: principal.id,
      clientId: userId,
      title: maskPii(title),
      notes: maskPii(notes ?? ''),
      status: status ?? 'active',
      position: resolvedPosition,
      items: items.map(maskItem),
    })
    .returning(workoutColumns);

  const workout = inserted[0];
  if (!workout) return json({ error: 'invalid' }, 400);

  await logAudit(principal, 'coach.plan.assign', 'account', userId, {
    workoutId: workout.id,
  });

  // Generic copy on purpose — the lock screen must never leak program details.
  after(() =>
    sendPushToAccount(userId, {
      title: 'New workout from your coach',
      body: 'Your coach assigned you a new workout.',
      data: { type: 'coach_plan' },
    }),
  );

  return json({ workout }, 201);
}
