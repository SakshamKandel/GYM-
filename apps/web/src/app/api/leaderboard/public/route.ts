import { accounts, syncedWorkouts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { bulkRanks } from '@/lib/gamification';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Public gym-wide consistency leaderboard.
 *
 *  - GET [?month=yyyy-mm] → top 50 accounts by session-days in the requested
 *    calendar month (distinct dates with a RANKED finished workout, capped
 *    1/day by the distinct-date count, exclusive month upper bound like the
 *    buddy leaderboard) plus the caller's own absolute position even when
 *    outside the top 50. `month` may only be the CURRENT or the PREVIOUS
 *    month (final standings view) — anything else is 400 invalid, so the
 *    endpoint can never be used to trawl a member's long-term attendance
 *    history month by month.
 *  - GET also returns, for the current month only, each row's 7-day position
 *    movement (`delta`: positive = climbed, null = wasn't on the board a week
 *    ago) and `totalRanked`, the number of members on the board.
 *  - PATCH {hidden: boolean} → the caller's opt-out flag ("Show me on the
 *    public leaderboard" toggle).
 *
 * PRIVACY LAW: each row exposes ONLY displayName / avatarUrl / tier / rank /
 * sessionDays / position / delta — never workout details, body data, or e1RM.
 * Accounts with publicBoardHidden=true (or suspended) are filtered out BEFORE
 * ranking, so they never appear NOR occupy a position — including in their
 * buddies' view of this board.
 *
 * NO PAY-TO-WIN: sort is sessionDays ONLY (tiebreak accountId for stable
 * ordering) — never kg, never XP, never tier. `tier` is membership IDENTITY
 * for the tier shield/frame the client renders, server-authoritative via
 * effectiveTier (lapsed subscriptions collapse to 'starter'). `rank` is the
 * earned gamification rank (bronze/silver/gold/elite) shown as a ring-only
 * emblem — neither field influences ordering.
 */

const patchSchema = z.object({
  hidden: z.boolean(),
});

export function OPTIONS() {
  return preflight();
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthWindow(monthKey: string): { monthStart: string; monthEndExclusive: string } {
  const next = new Date(`${monthKey}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { monthStart: `${monthKey}-01`, monthEndExclusive: next.toISOString().slice(0, 10) };
}

function previousMonthKey(monthKey: string): string {
  const prev = new Date(`${monthKey}-01T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  return prev.toISOString().slice(0, 7);
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const todayIso = new Date().toISOString().slice(0, 10);
  const currentMonthKey = todayIso.slice(0, 7);
  const prevMonthKey = previousMonthKey(currentMonthKey);

  // Scope: current month (live board) or previous month (final standings) —
  // nothing older (privacy: no attendance-history trawling).
  const url = new URL(req.url);
  const monthParam = url.searchParams.get('month');
  const monthKey = monthParam ?? currentMonthKey;
  if (monthKey !== currentMonthKey && monthKey !== prevMonthKey) {
    return json({ error: 'invalid' }, 400);
  }
  const isCurrentMonth = monthKey === currentMonthKey;
  const { monthStart, monthEndExclusive } = monthWindow(monthKey);

  const db = getDb();

  // Whole-gym ranked workouts in the window. Upper-bound the window to the
  // requested month only — without it, a future-dated workout (workout.date
  // is client-supplied, only regex-validated at ingest) would satisfy
  // gte(monthStart) in EVERY future month's leaderboard forever — a trivial
  // permanent session-day cheat.
  const workoutRows = await db
    .select({ accountId: syncedWorkouts.accountId, date: syncedWorkouts.date })
    .from(syncedWorkouts)
    .where(
      and(
        eq(syncedWorkouts.ranked, true),
        gte(syncedWorkouts.date, monthStart),
        lt(syncedWorkouts.date, monthEndExclusive),
      ),
    );

  // Distinct dates per account = session-days (naturally capped 1/day).
  const daysByAccount = new Map<string, Set<string>>();
  for (const w of workoutRows) {
    let days = daysByAccount.get(w.accountId);
    if (!days) daysByAccount.set(w.accountId, (days = new Set()));
    days.add(w.date);
  }

  // Caller is always a candidate (their `me` summary is returned even with
  // zero sessions this month).
  const candidateIds = [...new Set([...daysByAccount.keys(), user.id])];

  const infoRows =
    candidateIds.length > 0
      ? await db
          .select({
            id: accounts.id,
            displayName: accounts.displayName,
            tier: accounts.tier,
            tierExpiresAt: accounts.tierExpiresAt,
            publicBoardHidden: accounts.publicBoardHidden,
            status: accounts.status,
          })
          .from(accounts)
          .where(inArray(accounts.id, candidateIds))
      : [];
  const infoById = new Map(infoRows.map((r) => [r.id, r]));

  // Eligibility filter BEFORE ranking (privacy law): hidden or suspended
  // members never appear and never occupy a position — a hidden member's
  // buddies see the exact same board as everyone else.
  const eligible = candidateIds
    .map((id) => ({ id, info: infoById.get(id), sessionDays: daysByAccount.get(id)?.size ?? 0 }))
    .filter(
      (c): c is typeof c & { info: NonNullable<typeof c.info> } =>
        c.info !== undefined && c.info.status === 'active' && !c.info.publicBoardHidden && c.sessionDays > 0,
    )
    // Sort = sessionDays ONLY (design law: no pay-to-win) — accountId asc as
    // a stable, meaningless tiebreak for consistent pagination.
    .sort((a, b) => b.sessionDays - a.sessionDays || (a.id < b.id ? -1 : 1));

  // Competition ranking: position = 1 + count of strictly greater
  // sessionDays, so ties share a position (1, 2, 2, 4, ...).
  const countGreater = (days: number) => eligible.filter((e) => e.sessionDays > days).length;

  // 7-day movement — standings as they stood at the end of `deltaCutoff`,
  // recomputed from the SAME in-memory month rows (dates <= cutoff), against
  // the SAME eligible set. Only meaningful on the live board once the month
  // is at least a week old; the first week and the previous-month view carry
  // delta: null throughout ("new"/no movement shown client-side).
  const deltaCutoff = addDaysIso(todayIso, -7);
  const deltasEnabled = isCurrentMonth && deltaCutoff >= monthStart;
  const prevDaysById = new Map<string, number>();
  if (deltasEnabled) {
    const eligibleIds = new Set(eligible.map((e) => e.id));
    eligibleIds.add(user.id); // caller's own delta for the `me` summary
    const prevSets = new Map<string, Set<string>>();
    for (const w of workoutRows) {
      if (w.date > deltaCutoff || !eligibleIds.has(w.accountId)) continue;
      let days = prevSets.get(w.accountId);
      if (!days) prevSets.set(w.accountId, (days = new Set()));
      days.add(w.date);
    }
    for (const [id, days] of prevSets) prevDaysById.set(id, days.size);
  }
  // Previous standings restricted to still-eligible members with sessions at
  // the cutoff — same competition-ranking rule as today's board.
  const prevCounts = eligible
    .map((e) => prevDaysById.get(e.id) ?? 0)
    .filter((n) => n > 0);
  const prevPosition = (id: string): number | null => {
    const mine = prevDaysById.get(id) ?? 0;
    if (!deltasEnabled || mine === 0) return null;
    return 1 + prevCounts.filter((n) => n > mine).length;
  };

  const top = eligible.slice(0, 50);
  const ranks = await bulkRanks(
    db,
    top.map((t) => t.id),
  );

  const now = new Date();
  const rows = top.map((t) => {
    const position = 1 + countGreater(t.sessionDays);
    const prev = prevPosition(t.id);
    return {
      accountId: t.id,
      displayName: t.info.displayName,
      avatarUrl: null as string | null, // reserved — members have no stored avatar yet; client falls back to letter avatar
      tier: effectiveTier(t.info.tier, t.info.tierExpiresAt, now),
      rank: ranks.get(t.id) ?? 'bronze',
      sessionDays: t.sessionDays,
      position,
      // Positive = climbed since a week ago; null = new to the board (or
      // movement not applicable: first week of the month / last-month view).
      delta: prev === null ? null : prev - position,
      isMe: t.id === user.id,
    };
  });

  const callerInfo = infoById.get(user.id);
  const callerHidden = callerInfo?.publicBoardHidden ?? false;
  const callerDays = daysByAccount.get(user.id)?.size ?? 0;
  const callerPosition = callerHidden || callerDays === 0 ? null : 1 + countGreater(callerDays);
  const callerPrev = callerHidden ? null : prevPosition(user.id);
  const me = {
    // position is null when the caller is hidden (they occupy no slot) or has
    // no ranked session this month yet.
    position: callerPosition,
    sessionDays: callerDays,
    hidden: callerHidden,
    delta: callerPosition !== null && callerPrev !== null ? callerPrev - callerPosition : null,
  };

  return json({ month: monthKey, rows, me, totalRanked: eligible.length }, 200);
}

export async function PATCH(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { hidden } = parsed.data;

  const db = getDb();
  await db.update(accounts).set({ publicBoardHidden: hidden }).where(eq(accounts.id, user.id));

  return json({ hidden }, 200);
}
