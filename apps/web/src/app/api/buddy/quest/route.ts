import { accounts, syncedWorkouts } from '@gym/db';
import { and, eq, gte, lt } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { acceptedBuddyIds } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Co-op monthly quest: "both log 12 session-days this month" per buddy pair.
 * GET returns progress for every accepted buddy pair (server-computed,
 * RANKED workouts only). Completion itself is evaluated + awarded inside the
 * award engine (on sync ingest, check-in, and GET /api/gamification) — NOT
 * re-run inline here, since this route is polled every ~30s by the mobile
 * Buddy tab and re-running the full account-wide award engine on every poll
 * (doubled again by /api/challenges polling in the same Promise.all) does a
 * full table scan per tick for no correctness benefit: completion is already
 * fresh by the time either sync or the gamification snapshot GET runs.
 */

const QUEST_TARGET = 12;

export function OPTIONS() {
  return preflight();
}

function monthStartUtc(): { monthKey: string; monthStart: string; monthEndExclusive: string } {
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const next = new Date(`${monthKey}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { monthKey, monthStart: `${monthKey}-01`, monthEndExclusive: next.toISOString().slice(0, 10) };
}

async function sessionDaysThisMonth(
  db: ReturnType<typeof getDb>,
  accountId: string,
  monthStart: string,
  monthEndExclusive: string,
): Promise<number> {
  // Upper-bounded window — otherwise a future-dated workout would count
  // toward this quest in every future month's evaluation forever.
  const rows = await db
    .select({ date: syncedWorkouts.date })
    .from(syncedWorkouts)
    .where(
      and(
        eq(syncedWorkouts.accountId, accountId),
        eq(syncedWorkouts.ranked, true),
        gte(syncedWorkouts.date, monthStart),
        lt(syncedWorkouts.date, monthEndExclusive),
      ),
    );
  return new Set(rows.map((r) => r.date)).size;
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const buddyIds = await acceptedBuddyIds(db, user.id);
  const { monthKey, monthStart, monthEndExclusive } = monthStartUtc();

  const mine = await sessionDaysThisMonth(db, user.id, monthStart, monthEndExclusive);

  const pairs = [];
  for (const buddyId of buddyIds) {
    const nameRows = await db
      .select({ displayName: accounts.displayName })
      .from(accounts)
      .where(eq(accounts.id, buddyId))
      .limit(1);
    const theirs = await sessionDaysThisMonth(db, buddyId, monthStart, monthEndExclusive);
    pairs.push({
      buddyAccountId: buddyId,
      displayName: nameRows[0]?.displayName ?? '',
      mine,
      theirs,
      complete: mine >= QUEST_TARGET && theirs >= QUEST_TARGET,
    });
  }

  return json({ month: monthKey, target: QUEST_TARGET, pairs }, 200);
}
