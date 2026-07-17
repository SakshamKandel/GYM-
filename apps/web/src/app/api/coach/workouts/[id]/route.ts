import { type CoachAssignedWorkoutItem, coachAssignedWorkouts } from '@gym/db';
import { maskPii } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — edit or remove one assigned workout row (SCALE-UP-PLAN
 * §4.3). The owning client comes from the ROW (not the request), so a coach
 * can only ever touch rows belonging to a currently-assigned client — mirrors
 * coach/flags/[workoutId] and coach/suggestions/[id]'s "look up the row, then
 * requireCoachOwnsUser on its owner" shape.
 *
 *  - PATCH {title?, notes?, status?, position?, items?} → partial update; any
 *          field the caller sends is masked/validated the same way POST does.
 *  - DELETE → hard-removes the row (use PATCH {status:'archived'} to hide it
 *          from the client instead while keeping history).
 *
 * Guards (both verbs, fail closed): requirePermission('coach.message.user')
 * + requireCoachOwnsUser(principal, row.clientId) → 403 when not owned;
 * missing row → 404 (checked first, so a stale/foreign id never leaks a 403
 * vs 404 oracle).
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

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  items: z.array(workoutItemSchema).max(15).optional(),
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

/** Masks every client-visible free-text field of one item. */
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({
      id: coachAssignedWorkouts.id,
      clientId: coachAssignedWorkouts.clientId,
      coachId: coachAssignedWorkouts.coachId,
    })
    .from(coachAssignedWorkouts)
    .where(eq(coachAssignedWorkouts.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  // Author check (C16): only the coach who created this plan may edit/delete
  // it — a *currently-assigned* second coach must not touch another coach's
  // plans. super/main bypass. 404 (not 403) so a foreign id never leaks an
  // ownership oracle. Kept alongside requireCoachOwnsUser (assignment must
  // still be live) as defense-in-depth behind the singular-coach invariant.
  const isTopAdmin =
    principal.role === 'super_admin' || principal.role === 'main_admin';
  if (!isTopAdmin && row.coachId !== principal.id) {
    return json({ error: 'not_found' }, 404);
  }

  if (!(await requireCoachOwnsUser(principal, row.clientId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { title, notes, status, position, items } = parsed.data;

  const updated = await db
    .update(coachAssignedWorkouts)
    .set({
      ...(title !== undefined ? { title: maskPii(title) } : {}),
      ...(notes !== undefined ? { notes: maskPii(notes) } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(items !== undefined ? { items: items.map(maskItem) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(coachAssignedWorkouts.id, id))
    .returning(workoutColumns);

  const workout = updated[0];
  if (!workout) return json({ error: 'not_found' }, 404);

  await logAudit(principal, 'coach.plan.update', 'account', row.clientId, {
    workoutId: id,
  });

  after(() =>
    sendPushToAccount(row.clientId, {
      title: 'Workout updated',
      body: 'Your coach updated one of your workouts.',
      data: { type: 'coach_plan' },
    }),
  );

  return json({ workout }, 200);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({
      id: coachAssignedWorkouts.id,
      clientId: coachAssignedWorkouts.clientId,
      coachId: coachAssignedWorkouts.coachId,
    })
    .from(coachAssignedWorkouts)
    .where(eq(coachAssignedWorkouts.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  // Author check (C16): only the coach who created this plan may edit/delete
  // it — a *currently-assigned* second coach must not touch another coach's
  // plans. super/main bypass. 404 (not 403) so a foreign id never leaks an
  // ownership oracle. Kept alongside requireCoachOwnsUser (assignment must
  // still be live) as defense-in-depth behind the singular-coach invariant.
  const isTopAdmin =
    principal.role === 'super_admin' || principal.role === 'main_admin';
  if (!isTopAdmin && row.coachId !== principal.id) {
    return json({ error: 'not_found' }, 404);
  }

  if (!(await requireCoachOwnsUser(principal, row.clientId))) {
    return json({ error: 'forbidden' }, 403);
  }

  await db.delete(coachAssignedWorkouts).where(eq(coachAssignedWorkouts.id, id));

  await logAudit(principal, 'coach.plan.update', 'account', row.clientId, {
    workoutId: id,
    deleted: true,
  });

  return json({ ok: true }, 200);
}
