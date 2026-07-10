import { coachMilestones } from '@gym/db';
import { maskPii } from '@gym/shared';
import { desc, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — a client's coach-logged milestones.
 *
 *  - GET  → the client's milestones, newest achievedAt first.
 *  - POST {title, note?, achievedAt?} → logs one (achievedAt defaults to today,
 *          UTC). Title/note are PII-masked BEFORE storage — the member reads
 *          these verbatim, so the in-app-contact policy applies here too. The
 *          member gets a push, best-effort via after().
 *
 * Guards (fail closed): requireCoachOwnsUser on both verbs; POST additionally
 * needs 'coach.message.user' (it writes into the member's story).
 */

const postSchema = z.object({
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).optional(),
  achievedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

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

  const milestones = await getDb()
    .select({
      id: coachMilestones.id,
      title: coachMilestones.title,
      note: coachMilestones.note,
      achievedAt: coachMilestones.achievedAt,
      createdAt: coachMilestones.createdAt,
    })
    .from(coachMilestones)
    .where(eq(coachMilestones.accountId, userId))
    .orderBy(desc(coachMilestones.achievedAt), desc(coachMilestones.createdAt));

  return json({ milestones }, 200);
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
  const { title, note, achievedAt } = parsed.data;

  const inserted = await getDb()
    .insert(coachMilestones)
    .values({
      coachId: principal.id,
      accountId: userId,
      title: maskPii(title),
      note: maskPii(note ?? ''),
      achievedAt: achievedAt ?? new Date().toISOString().slice(0, 10),
    })
    .returning({
      id: coachMilestones.id,
      title: coachMilestones.title,
      note: coachMilestones.note,
      achievedAt: coachMilestones.achievedAt,
      createdAt: coachMilestones.createdAt,
    });

  const milestone = inserted[0];
  if (!milestone) return json({ error: 'invalid' }, 400);

  await logAudit(principal, 'coach.milestone.log', 'account', userId, {
    milestoneId: milestone.id,
  });

  // Generic copy on purpose — milestone titles can carry health details that
  // must not appear on the lock screen; the full text arrives in-app.
  after(() =>
    sendPushToAccount(userId, {
      title: 'New milestone',
      body: 'Your coach logged a milestone for you.',
      data: { type: 'milestone_logged' },
    }),
  );

  return json({ milestone }, 201);
}
