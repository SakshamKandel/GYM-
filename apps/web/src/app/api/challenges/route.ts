import { accounts, challengeMembers, coachAssignments, coachChallenges, syncedWorkouts } from '@gym/db';
import { and, eq, gte, lt } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * The caller's ACTIVE coach's challenge for the current month, if one exists
 * and the coach has created it. Only one active coach assignment is expected
 * per member in practice; if more than one is active this picks the most
 * recently assigned one (arbitrary but deterministic tie-break).
 *
 * Completion itself is evaluated + awarded inside the award engine (on sync
 * ingest, check-in, and GET /api/gamification) — NOT re-run inline here; this
 * route is polled alongside /api/buddy/quest by the mobile Buddy tab every
 * ~30s, and a full account-wide award-engine recompute on every poll doubles
 * the cost for no correctness benefit.
 */

export function OPTIONS() {
  return preflight();
}

function currentMonthWindow(): { monthKey: string; monthStart: string; monthEndExclusive: string } {
  const monthKey = new Date().toISOString().slice(0, 7);
  const next = new Date(`${monthKey}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { monthKey, monthStart: `${monthKey}-01`, monthEndExclusive: next.toISOString().slice(0, 10) };
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const { monthKey, monthStart, monthEndExclusive } = currentMonthWindow();

  const assignmentRows = await db
    .select({ coachId: coachAssignments.coachId })
    .from(coachAssignments)
    .where(and(eq(coachAssignments.userId, user.id), eq(coachAssignments.status, 'active')))
    .orderBy(coachAssignments.createdAt)
    .limit(1);
  const coachId = assignmentRows[0]?.coachId;
  if (!coachId) return json({ challenge: null }, 200);

  const challengeRows = await db
    .select({
      id: coachChallenges.id,
      title: coachChallenges.title,
      monthKey: coachChallenges.monthKey,
      targetDays: coachChallenges.targetDays,
    })
    .from(coachChallenges)
    .where(and(eq(coachChallenges.coachId, coachId), eq(coachChallenges.monthKey, monthKey)))
    .limit(1);
  const challenge = challengeRows[0];
  if (!challenge) return json({ challenge: null }, 200);

  const coachRows = await db
    .select({ displayName: accounts.displayName })
    .from(accounts)
    .where(eq(accounts.id, coachId))
    .limit(1);

  const memberRows = await db
    .select({ id: challengeMembers.id })
    .from(challengeMembers)
    .where(and(eq(challengeMembers.challengeId, challenge.id), eq(challengeMembers.accountId, user.id)))
    .limit(1);
  const joined = memberRows.length > 0;

  // Upper-bounded window — otherwise a future-dated workout would count
  // toward this challenge in every future month's evaluation forever.
  const workoutRows = await db
    .select({ date: syncedWorkouts.date })
    .from(syncedWorkouts)
    .where(
      and(
        eq(syncedWorkouts.accountId, user.id),
        eq(syncedWorkouts.ranked, true),
        gte(syncedWorkouts.date, monthStart),
        lt(syncedWorkouts.date, monthEndExclusive),
      ),
    );
  const myDays = new Set(workoutRows.map((r) => r.date)).size;

  return json(
    {
      challenge: {
        id: challenge.id,
        title: challenge.title,
        monthKey: challenge.monthKey,
        targetDays: challenge.targetDays,
        coachName: coachRows[0]?.displayName ?? '',
        joined,
        myDays,
        complete: joined && myDays >= challenge.targetDays,
      },
    },
    200,
  );
}
