import { accounts, syncedWorkouts, type Db } from '@gym/db';
import { effectiveTier, ktmDateString } from '@gym/shared';
import { and, asc, countDistinct, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
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

/** How many rows the board returns — the page, not the whole gym. */
const BOARD_SIZE = 50;

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

/** Postgres returns counts as numbers and bigints as strings. Accept both. */
function intFrom(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * The caller's own standing when they rank BELOW the returned page — the only
 * case the page itself can't answer. Same rule as the board's `rank()`:
 * position = 1 + however many eligible members hold strictly more session-days
 * (ties share a position), and the same again over the as-of-`deltaCutoff`
 * counts. Counted in Postgres, so a member sitting at #900 still costs one
 * small row rather than shipping the other 899 into Node.
 *
 * `eligibleWhere` is the caller's board's own eligibility filter, passed in so
 * the two can never drift apart.
 */
async function loadCallerStanding(
  db: Db,
  eligibleWhere: SQL | undefined,
  deltaCutoff: string,
  sessionDays: number,
  prevDays: number,
): Promise<{ position: number; prevPosition: number }> {
  const result = await db.execute(sql`
    select
      (count(*) filter (where agg.session_days > ${sessionDays}))::int as greater_days,
      (count(*) filter (where agg.prev_days > ${prevDays}))::int as greater_prev
    from (
      select
        count(distinct ${syncedWorkouts.date}) as session_days,
        count(distinct ${syncedWorkouts.date}) filter (
          where ${syncedWorkouts.date} <= ${deltaCutoff}
        ) as prev_days
      from ${syncedWorkouts}
      inner join ${accounts} on ${accounts.id} = ${syncedWorkouts.accountId}
      where ${eligibleWhere}
      group by ${accounts.id}
    ) agg
  `);
  const row = result.rows[0];
  return {
    position: 1 + intFrom(row, 'greater_days'),
    prevPosition: 1 + intFrom(row, 'greater_prev'),
  };
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

  // Today on the SAME day boundary the rest of the product uses (Nepal
  // wall-clock, UTC+05:45), because that is the boundary the workout dates this
  // board counts were recorded on. Reading it off UTC instead put the server
  // 5h45m behind the members for that slice of every day: between midnight and
  // 05:45 KTM on the 1st, a session logged and dated "the 1st" was ranked into
  // a window the server still believed was the previous month, so it counted
  // for neither board.
  const todayIso = ktmDateString(new Date());
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

  // Competition ranking, done in Postgres over the grouped set instead of
  // pulling every ranked member into Node to count them there. `rank()` IS the
  // rule this board has always used: a row's position is 1 + however many rows
  // hold strictly more session-days, so ties share a position (1, 2, 2, 4, ...)
  // and the next position skips. `prevPosition` applies the same rule to the
  // as-of-`deltaCutoff` counts; members with prevDays = 0 can only ever sit
  // BELOW a row with prevDays >= 1, so they never shift anyone's previous
  // position, exactly like the old filtered-in-JS list. `totalRanked` is the
  // size of the whole eligible board, counted before the 50-row cut.
  const positionExpr = sql<number>`(rank() over (order by ${sessionDaysExpr} desc))::int`.mapWith(Number);
  const prevPositionExpr = sql<number>`(rank() over (order by ${prevDaysExpr} desc))::int`.mapWith(Number);
  const totalRankedExpr = sql<number>`(count(*) over ())::int`.mapWith(Number);

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

  // Eligibility filter BEFORE ranking (privacy law): hidden or suspended
  // members never appear and never occupy a position — a hidden member's
  // buddies see the exact same board as everyone else.
  const eligibleWhere = and(
    monthWindowWhere(),
    eq(accounts.status, 'active'),
    eq(accounts.publicBoardHidden, false),
  );

  const [top, callerAggRows, callerAccountRows] = await Promise.all([
    // The 50 rows the board shows, ranked, counted and cut in Postgres. The
    // whole gym used to come back here so Node could count it; now only the
    // page does. Sort = sessionDays ONLY (design law: no pay-to-win) —
    // accountId asc as a stable, meaningless tiebreak, which is also what
    // decides who takes the last slot when the boundary is a tie.
    db
      .select({
        id: accounts.id,
        displayName: accounts.displayName,
        tier: accounts.tier,
        tierExpiresAt: accounts.tierExpiresAt,
        sessionDays: sessionDaysExpr,
        prevDays: prevDaysExpr,
        position: positionExpr,
        prevPosition: prevPositionExpr,
        totalRanked: totalRankedExpr,
      })
      .from(syncedWorkouts)
      .innerJoin(accounts, eq(accounts.id, syncedWorkouts.accountId))
      .where(eligibleWhere)
      .groupBy(accounts.id)
      .orderBy(desc(sessionDaysExpr), asc(accounts.id))
      .limit(BOARD_SIZE),
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

  const callerHidden = callerAccountRows[0]?.publicBoardHidden ?? false;
  const callerDays = callerAggRows[0]?.sessionDays ?? 0;
  const callerPrevDays = callerAggRows[0]?.prevDays ?? 0;

  // The caller holds a position exactly when they are on the board: not hidden
  // (a hidden member occupies no slot) and with at least one ranked session
  // this month. `userForToken` already refused a suspended account, so an
  // eligible caller is one of the rows the ranking above was computed over —
  // their standing is either in the page or one extra count away.
  const onBoard = !callerHidden && callerDays > 0;
  const mine = onBoard ? top.find((t) => t.id === user.id) : undefined;

  const [ranks, outsideStanding] = await Promise.all([
    bulkRanks(
      db,
      top.map((t) => t.id),
    ),
    onBoard && mine === undefined
      ? loadCallerStanding(db, eligibleWhere, deltaCutoff, callerDays, callerPrevDays)
      : Promise.resolve(null),
  ]);

  const now = new Date();
  const rows = top.map((t) => {
    // Positive = climbed since a week ago; null = new to the board (or
    // movement not applicable: first week of the month / last-month view).
    const prev = deltasEnabled && t.prevDays > 0 ? t.prevPosition : null;
    return {
      accountId: t.id,
      displayName: t.displayName,
      avatarUrl: null as string | null, // reserved — members have no stored avatar yet; client falls back to letter avatar
      tier: effectiveTier(t.tier, t.tierExpiresAt, now),
      rank: ranks.get(t.id) ?? 'bronze',
      sessionDays: t.sessionDays,
      position: t.position,
      delta: prev === null ? null : prev - t.position,
      isMe: t.id === user.id,
    };
  });

  const callerPosition = onBoard ? (mine?.position ?? outsideStanding?.position ?? null) : null;
  const callerPrev =
    deltasEnabled && callerPrevDays > 0
      ? (mine?.prevPosition ?? outsideStanding?.prevPosition ?? null)
      : null;
  const me = {
    // position is null when the caller is hidden (they occupy no slot) or has
    // no ranked session this month yet.
    position: callerPosition,
    sessionDays: callerDays,
    hidden: callerHidden,
    delta: callerPosition !== null && callerPrev !== null ? callerPrev - callerPosition : null,
  };

  return json({ month: monthKey, rows, me, totalRanked: top[0]?.totalRanked ?? 0 }, 200);
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
