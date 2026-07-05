import { challengeMembers, coachAssignments, coachChallenges } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member opt-in to their coach's monthly challenge.
 *
 *  - POST → inserts a challengeMembers row for the caller, idempotent
 *    (onConflictDoNothing on the unique challenge+account index). Rejects
 *    with 409 {error:'wrong_month'} if the challenge isn't for the current
 *    month, and 403 if the caller isn't an active client of that challenge's
 *    coach (challenge id alone doesn't prove ownership — must check the roster).
 */

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function OPTIONS() {
  return preflight();
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerToken(_req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;
  const db = getDb();

  const challengeRows = await db
    .select({ id: coachChallenges.id, coachId: coachChallenges.coachId, monthKey: coachChallenges.monthKey })
    .from(coachChallenges)
    .where(eq(coachChallenges.id, id))
    .limit(1);
  const challenge = challengeRows[0];
  if (!challenge) return json({ error: 'not_found' }, 404);

  if (challenge.monthKey !== currentMonthKey()) {
    return json({ error: 'wrong_month' }, 409);
  }

  const assignmentRows = await db
    .select({ id: coachAssignments.id })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.coachId, challenge.coachId),
        eq(coachAssignments.userId, user.id),
        eq(coachAssignments.status, 'active'),
      ),
    )
    .limit(1);
  if (assignmentRows.length === 0) return json({ error: 'forbidden' }, 403);

  await db
    .insert(challengeMembers)
    .values({ challengeId: challenge.id, accountId: user.id })
    .onConflictDoNothing({ target: [challengeMembers.challengeId, challengeMembers.accountId] });

  return json({ ok: true }, 200);
}
