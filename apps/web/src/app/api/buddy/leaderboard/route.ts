import { accounts, syncedWorkouts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { acceptedBuddyIds } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Buddy leaderboard — ranked by session-days THIS calendar month, capped
 * 1/day (a distinct-date count already caps that), RANKED workouts only
 * (design law: flagged sessions don't count toward competitive surfaces).
 * Includes the caller's own row. XP/level/rank are NEVER included here
 * (design law 5 — personal-only, never on a competitive surface).
 *
 * `tier` is included purely as membership IDENTITY for the tier shield the
 * client renders next to each name — it is server-authoritative (effective
 * tier, lapsed subscriptions collapse to 'starter') and must never influence
 * sort order, XP, or rank. Sort stays sessionDays-only.
 */

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

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const buddyIds = await acceptedBuddyIds(db, user.id);
  const memberIds = [user.id, ...buddyIds];

  const { monthKey, monthStart, monthEndExclusive } = monthStartUtc();

  // Upper-bound the window to THIS month only. Without it, a future-dated
  // workout (workout.date is client-supplied, only regex-validated at
  // ingest) would satisfy gte(monthStart) in EVERY future month's
  // leaderboard forever — a trivial permanent session-day cheat.
  const workoutRows = await db
    .select({ accountId: syncedWorkouts.accountId, date: syncedWorkouts.date })
    .from(syncedWorkouts)
    .where(
      and(
        inArray(syncedWorkouts.accountId, memberIds),
        eq(syncedWorkouts.ranked, true),
        gte(syncedWorkouts.date, monthStart),
        lt(syncedWorkouts.date, monthEndExclusive),
      ),
    );

  const daysByAccount = new Map<string, Set<string>>();
  for (const id of memberIds) daysByAccount.set(id, new Set());
  for (const w of workoutRows) daysByAccount.get(w.accountId)?.add(w.date);

  const nameRows = await db
    .select({
      id: accounts.id,
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
    })
    .from(accounts)
    .where(inArray(accounts.id, memberIds));
  const infoById = new Map(nameRows.map((r) => [r.id, r]));

  const now = new Date();
  const rows = memberIds
    .map((id) => {
      const info = infoById.get(id);
      return {
        accountId: id,
        displayName: info?.displayName ?? '',
        tier: effectiveTier(info?.tier ?? 'starter', info?.tierExpiresAt ?? null, now),
        sessionDays: daysByAccount.get(id)?.size ?? 0,
        isMe: id === user.id,
      };
    })
    .sort((a, b) => b.sessionDays - a.sessionDays);

  return json({ month: monthKey, rows }, 200);
}
