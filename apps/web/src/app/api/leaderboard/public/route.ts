import { accounts, syncedWorkouts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, asc, countDistinct, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { bulkRanks } from '@/lib/gamification';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

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

  // Whole-gym aggregation — cheap now that it's grouped in SQL, but still
  // worth capping scripted refresh spam.
  const limited = rateLimit({
    route: 'leaderboard/public',
    limit: 30,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

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

  // 7-day movement cutoff — standings as they stood at the end of
  // `deltaCutoff`. Only meaningful on the live board once the month is at
  // least a week old; the first week and the previous-month view carry
  // delta: null throughout ("new"/no movement shown client-side).
  const deltaCutoff = addDaysIso(todayIso, -7);
  const deltasEnabled = isCurrentMonth && deltaCutoff >= monthStart;

  // Session-days = distinct dates with a ranked workout (naturally capped
  // 1/day); prevDays = the same count as of `deltaCutoff`, from the same scan.
  const sessionDaysExpr = countDistinct(syncedWorkouts.date);
  const prevDaysExpr = sql<number>`count(distinct ${syncedWorkouts.date}) filter (where ${syncedWorkouts.date} <= ${deltaCutoff})`.mapWith(Number);

  // Whole-gym ranked workouts in the window, aggregated IN SQL (GROUP BY
  // account) so only one row per member reaches Node — never the raw workout
  // rows. Upper-bound the window to the requested month only — without it, a
  // future-dated workout (workout.date is client-supplied, only
  // regex-validated at ingest) would satisfy gte(monthStart) in EVERY future
  // month's leaderboard forever — a trivial permanent session-day cheat.
  const monthWindowWhere = () =>
    and(
      eq(syncedWorkouts.ranked, true),
      gte(syncedWorkouts.date, monthStart),
      lt(syncedWorkouts.date, monthEndExclusive),
    );

  const [eligible, callerAggRows, callerAccountRows] = await Promise.all([
    // Eligibility filter BEFORE ranking (privacy law): hidden or suspended
    // members never appear and never occupy a position — a hidden member's
    // buddies see the exact same board as everyone else. Sort = sessionDays
    // ONLY (design law: no pay-to-win) — accountId asc as a stable,
    // meaningless tiebreak for consistent pagination.
    db
      .select({
        id: accounts.id,
        displayName: accounts.displayName,
        tier: accounts.tier,
        tierExpiresAt: accounts.tierExpiresAt,
        sessionDays: sessionDaysExpr,
        prevDays: prevDaysExpr,
      })
      .from(syncedWorkouts)
      .innerJoin(accounts, eq(accounts.id, syncedWorkouts.accountId))
      .where(
        and(
          monthWindowWhere(),
          eq(accounts.status, 'active'),
          eq(accounts.publicBoardHidden, false),
        ),
      )
      .groupBy(accounts.id)
      .orderBy(desc(sessionDaysExpr), asc(accounts.id)),
    // Caller's own counts — the `me` summary reports sessionDays even when
    // the caller is hidden or has no ranked session (counts come back 0).
    db
      .select({ sessionDays: sessionDaysExpr, prevDays: prevDaysExpr })
      .from(syncedWorkouts)
      .where(and(monthWindowWhere(), eq(syncedWorkouts.accountId, user.id))),
    db
      .select({ publicBoardHidden: accounts.publicBoardHidden })
      .from(accounts)
      .where(eq(accounts.id, user.id))
      .limit(1),
  ]);

  // Competition ranking: position = 1 + count of strictly greater
  // sessionDays, so ties share a position (1, 2, 2, 4, ...).
  const countGreater = (days: number) => eligible.filter((e) => e.sessionDays > days).length;

  // Previous standings restricted to still-eligible members with sessions at
  // the cutoff — same competition-ranking rule as today's board.
  const prevCounts = eligible.map((e) => e.prevDays).filter((n) => n > 0);
  const prevPositionOf = (prevDays: number): number | null => {
    if (!deltasEnabled || prevDays === 0) return null;
    return 1 + prevCounts.filter((n) => n > prevDays).length;
  };

  const top = eligible.slice(0, 50);
  const ranks = await bulkRanks(
    db,
    top.map((t) => t.id),
  );

  const now = new Date();
  const rows = top.map((t) => {
    const position = 1 + countGreater(t.sessionDays);
    const prev = prevPositionOf(t.prevDays);
    return {
      accountId: t.id,
      displayName: t.displayName,
      avatarUrl: null as string | null, // reserved — members have no stored avatar yet; client falls back to letter avatar
      tier: effectiveTier(t.tier, t.tierExpiresAt, now),
      rank: ranks.get(t.id) ?? 'bronze',
      sessionDays: t.sessionDays,
      position,
      // Positive = climbed since a week ago; null = new to the board (or
      // movement not applicable: first week of the month / last-month view).
      delta: prev === null ? null : prev - position,
      isMe: t.id === user.id,
    };
  });

  const callerHidden = callerAccountRows[0]?.publicBoardHidden ?? false;
  const callerDays = callerAggRows[0]?.sessionDays ?? 0;
  const callerPosition = callerHidden || callerDays === 0 ? null : 1 + countGreater(callerDays);
  const callerPrev = callerHidden ? null : prevPositionOf(callerAggRows[0]?.prevDays ?? 0);
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
