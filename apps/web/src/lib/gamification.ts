import {
  accounts,
  awardedBadges,
  buddyLinks,
  buddyQuestAwards,
  challengeMembers,
  checkIns,
  coachChallenges,
  gamificationProfiles,
  restShieldUses,
  syncedSets,
  syncedWorkouts,
  xpEvents,
  type Db,
} from '@gym/db';
import {
  BADGE_CATALOG,
  PR_XP_WEEKLY_CAP,
  XP_AWARDS,
  canonicalLift,
  computeEarnedBadgeIds,
  computeRank,
  computeWeeklyStreak,
  effectiveTier,
  epley1Rm,
  levelProgress,
  planShieldUse,
  restShieldQuota,
  weekStartIso,
  type BadgeComputeInput,
  type BadgeProgressStats,
  type Rank,
} from '@gym/shared';
import { and, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { acceptedBuddyIds } from './buddy';
import { getDb } from './db';

/**
 * Gamification award engine — the SINGLE place that computes and persists XP,
 * streaks, badges, and quest/challenge completions. Called inline (cheap,
 * idempotent) from:
 *  - GET /api/gamification via `runAwardEngineOrThrow` (every read recomputes
 *    the cache; errors propagate so the route can return a real HTTP failure
 *    instead of serving a fabricated snapshot as 200)
 *  - after(() => runAwardEngine(accountId)) on sync ingest, check-in insert,
 *    and coach flag restore — fire-and-forget, so this variant never throws
 *
 * Idempotency: xpEvents unique(accountId,kind,sourceKey), awardedBadges
 * unique(accountId,badgeId), restShieldUses unique(accountId,weekStart),
 * buddyQuestAwards unique(monthKey,accountA,accountB), coachPicks/
 * coachChallenges unique(coachId,monthKey) — every insert here uses
 * onConflictDoNothing so re-running this function is always safe.
 *
 * `runAwardEngine` NEVER throws — any unexpected error is caught, logged, and
 * masked with a fabricated all-zero snapshot so a gamification bug can never
 * break sync, check-ins, or coach flag restores. `runAwardEngineOrThrow`
 * shares the same inner implementation but propagates errors — see its own
 * doc comment below for why GET /api/gamification needs that instead.
 */

// ── Small date helpers (server has no local timezone — UTC yyyy-mm-dd is the
//    consistent "today" for month/week bucketing; workout dates themselves
//    are always the client's stored LOCAL date string, per gotcha #2) ────────

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day (yyyy-mm-01) of the month AFTER `monthKey` (yyyy-mm). */
function nextMonthStart(monthKey: string): string {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export interface GamificationResult {
  profile: {
    xpTotal: number;
    level: number;
    xpIntoLevel: number;
    xpForNextLevel: number;
    rank: Rank;
    weeklyTargetDays: number;
  };
  streak: {
    weeks: number;
    bestWeeks: number;
    thisWeekDays: number;
    weekStart: string;
    shieldedWeekStarts: string[];
  };
  shields: {
    quota: number;
    usedThisMonth: number;
    remaining: number;
  };
  badges: {
    earned: number;
    total: number;
  };
  newBadgeIds: string[];
}

/**
 * Recompute everything for one account: XP ledger top-ups, weekly streak
 * cache, Rest Shield auto-consumption, badge awards, and buddy-quest /
 * coach-challenge completions. Safe to call as often as needed.
 *
 * NEVER throws — for the fire-and-forget `after()` callers (sync ingest,
 * check-in insert, coach flag restore) where a gamification bug must never
 * surface to the caller. Returns a fabricated all-zero snapshot on error,
 * which is fine for THOSE callers since they discard the return value.
 *
 * GET /api/gamification does NOT use this directly — it uses
 * `runAwardEngineOrThrow` below so a transient failure there produces a 503
 * instead of silently serving zeroed-out XP/rank/shields as if they were
 * real, which would overwrite a paying user's correct mobile-side state.
 */
export async function runAwardEngine(accountId: string): Promise<GamificationResult> {
  try {
    return await runAwardEngineInner(accountId);
  } catch (err) {
    console.error('[gamification] runAwardEngine failed', err);
    // Fail-safe default so fire-and-forget callers never crash on a
    // gamification bug — NOT suitable as an HTTP 200 response body (see
    // runAwardEngineOrThrow for the route-facing variant).
    return {
      profile: {
        xpTotal: 0,
        level: 1,
        xpIntoLevel: 0,
        xpForNextLevel: 100,
        rank: 'bronze',
        weeklyTargetDays: 3,
      },
      streak: { weeks: 0, bestWeeks: 0, thisWeekDays: 0, weekStart: todayIsoUtc(), shieldedWeekStarts: [] },
      shields: { quota: 0, usedThisMonth: 0, remaining: 0 },
      badges: { earned: 0, total: BADGE_CATALOG.length },
      newBadgeIds: [],
    };
  }
}

/**
 * Same computation as `runAwardEngine`, but PROPAGATES errors instead of
 * masking them with a fabricated zeroed snapshot. Use this from
 * request-serving routes (GET /api/gamification) that return their result
 * directly to the client with a 200 — so a transient DB error (or the
 * deploy window before a new gamification table/column exists) surfaces as
 * an HTTP failure the client already knows how to handle (keep showing its
 * last cached state) instead of a fake "Bronze · Level 1 · 0 shields" that
 * looks like real data.
 */
export async function runAwardEngineOrThrow(accountId: string): Promise<GamificationResult> {
  return runAwardEngineInner(accountId);
}

async function runAwardEngineInner(accountId: string): Promise<GamificationResult> {
  const db = getDb();
  const today = todayIsoUtc();
  const monthKey = monthKeyOf(today);

  // ── Load account tier (effective) + existing gamification profile row ────
  const accountRows = await db
    .select({ tier: accounts.tier, tierExpiresAt: accounts.tierExpiresAt })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  const account = accountRows[0];
  if (!account) throw new Error(`account not found: ${accountId}`);

  const tier = effectiveTier(account.tier, account.tierExpiresAt, new Date());

  const profileRows = await db
    .select()
    .from(gamificationProfiles)
    .where(eq(gamificationProfiles.accountId, accountId))
    .limit(1);
  let profile = profileRows[0];
  if (!profile) {
    const inserted = await db
      .insert(gamificationProfiles)
      .values({ accountId })
      .onConflictDoNothing({ target: gamificationProfiles.accountId })
      .returning();
    profile =
      inserted[0] ??
      (
        await db
          .select()
          .from(gamificationProfiles)
          .where(eq(gamificationProfiles.accountId, accountId))
          .limit(1)
      )[0];
  }
  const weeklyTargetDays = profile?.weeklyTargetDays ?? 3;

  // ── Pull ALL finished workouts (ranked + unranked — streak/day_one/comeback
  //    use all finished sessions per design law 4) ─────────────────────────
  const allWorkouts = await db
    .select({
      id: syncedWorkouts.id,
      date: syncedWorkouts.date,
      ranked: syncedWorkouts.ranked,
    })
    .from(syncedWorkouts)
    .where(eq(syncedWorkouts.accountId, accountId));

  const sessionDayIsos = [...new Set(allWorkouts.map((w) => w.date))].sort();
  const rankedWorkoutIds = new Set(allWorkouts.filter((w) => w.ranked).map((w) => w.id));
  const lifetimeSessionDays = sessionDayIsos.length;

  // ── Existing Rest Shield uses + plan new ones ────────────────────────────
  const existingShields = await db
    .select({ weekStart: restShieldUses.weekStart, monthKey: restShieldUses.monthKey })
    .from(restShieldUses)
    .where(eq(restShieldUses.accountId, accountId));

  const quota = restShieldQuota(tier);
  const planned = planShieldUse({
    sessionDayIsos,
    weeklyTarget: weeklyTargetDays,
    todayIso: today,
    existingUses: existingShields,
    quotaPerMonth: quota,
  });

  if (planned.length > 0) {
    await db
      .insert(restShieldUses)
      .values(planned.map((p) => ({ accountId, weekStart: p.weekStart, monthKey: p.monthKey })))
      .onConflictDoNothing({ target: [restShieldUses.accountId, restShieldUses.weekStart] });
  }
  // Re-read after insert so shieldedWeekStarts reflects everything on record
  // (existing + freshly planned) even though the unique index above is on
  // (accountId, weekStart) not accountId alone — reload explicitly.
  const shieldRows = await db
    .select({ weekStart: restShieldUses.weekStart, monthKey: restShieldUses.monthKey })
    .from(restShieldUses)
    .where(eq(restShieldUses.accountId, accountId));
  const shieldedWeekStarts = shieldRows.map((r) => r.weekStart);
  const usedThisMonth = shieldRows.filter((r) => r.monthKey === monthKey).length;

  // ── Weekly streak (shared pure logic) ────────────────────────────────────
  const streak = computeWeeklyStreak(sessionDayIsos, weeklyTargetDays, today, shieldedWeekStarts);
  const bestStreakWeeks = Math.max(streak.weeks, profile?.bestStreakWeeks ?? 0);

  // ── XP: daily_workout (first finished workout each day, ranked+unranked —
  //    XP is about showing up, mirrors streak's LAW-4 treatment), streak_week,
  //    checkin, pr (capped 5/week) ───────────────────────────────────────────
  const xpInserts: { kind: 'daily_workout' | 'streak_week' | 'checkin' | 'pr'; sourceKey: string; amount: number }[] =
    [];

  for (const day of sessionDayIsos) {
    xpInserts.push({ kind: 'daily_workout', sourceKey: day, amount: XP_AWARDS.daily_workout });
  }

  // Completed weeks (EVERY fully-elapsed week that met target or was
  // shielded, not just the unbroken consecutive suffix) get streak_week XP.
  // Unlike the streak COUNT (which intentionally breaks at the first gap —
  // that's what makes it a "consecutive" streak), XP is an idempotent ledger
  // (unique on accountId+kind+sourceKey): if the engine skips a run for a
  // week or two (e.g. the user goes inactive and no GET/sync happens until
  // two weeks later), a legitimately-completed week's XP must still be
  // awarded whenever the engine eventually looks back far enough — the walk
  // here does NOT stop at the first miss.
  {
    const dayCounts = new Map<string, number>();
    for (const day of sessionDayIsos) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    const shieldSet = new Set(shieldedWeekStarts);
    const currentWeekStart = weekStartIso(today);
    let cursor = addDaysIso(currentWeekStart, -7);
    const MAX_WEEKS_BACK = 520;
    for (let i = 0; i < MAX_WEEKS_BACK; i++) {
      let daysInWeek = 0;
      for (let d = 0; d < 7; d++) {
        if (dayCounts.has(addDaysIso(cursor, d))) daysInWeek++;
      }
      const met = daysInWeek >= weeklyTargetDays || shieldSet.has(cursor);
      if (met) {
        xpInserts.push({ kind: 'streak_week', sourceKey: cursor, amount: XP_AWARDS.streak_week });
      }
      cursor = addDaysIso(cursor, -7);
    }
  }

  // Check-ins → XP, bounded to ONE per ISO week (design law 1: "weekly
  // check-in submitted +30" is the bounded event, not per row — check_ins is
  // unique per (account, date) so a daily-check-in user would otherwise mint
  // 30 XP per day). sourceKey = the check-in's week start, so the xpEvents
  // unique index (accountId, kind, sourceKey) caps it at one per week
  // regardless of how many check-in rows land in that week.
  const checkInRows = await db
    .select({ id: checkIns.id, date: checkIns.date })
    .from(checkIns)
    .where(eq(checkIns.accountId, accountId));
  const checkInWeeksAwarded = new Set<string>();
  for (const c of checkInRows.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const wk = weekStartIso(c.date);
    if (checkInWeeksAwarded.has(wk)) continue;
    checkInWeeksAwarded.add(wk);
    xpInserts.push({ kind: 'checkin', sourceKey: wk, amount: XP_AWARDS.checkin });
  }

  // ── Badges: build BadgeComputeInput from RANKED workouts/sets (except
  //    day_one/comeback which use all finished sessions per contract) ──────
  const rankedSetRows = await db
    .select({
      id: syncedSets.id,
      exerciseId: syncedSets.exerciseId,
      exerciseName: syncedSets.exerciseName,
      weightKg: syncedSets.weightKg,
      reps: syncedSets.reps,
      workoutId: syncedSets.workoutId,
      loggedAt: syncedSets.loggedAt,
    })
    .from(syncedSets)
    .where(eq(syncedSets.accountId, accountId));
  const rankedSets = rankedSetRows.filter((s) => rankedWorkoutIds.has(s.workoutId));

  const realPrSets = walkRealPrSets(rankedSets);

  // PRs → XP, capped PR_XP_WEEKLY_CAP per ISO week (sourceKey = setId)
  const prCountByWeek = new Map<string, number>();
  // Already-awarded PR xp events this account has (so the cap counts against
  // history, not just this run).
  const existingPrEvents = await db
    .select({ sourceKey: xpEvents.sourceKey })
    .from(xpEvents)
    .where(and(eq(xpEvents.accountId, accountId), eq(xpEvents.kind, 'pr')));
  const existingPrSetIds = new Set(existingPrEvents.map((e) => e.sourceKey));
  // Seed week counts from sets that already earned PR xp, keyed by the set's
  // logged week, so a re-run doesn't re-derive the cap from scratch.
  for (const s of realPrSets) {
    if (!existingPrSetIds.has(s.id)) continue;
    const wk = weekStartIso(s.loggedAt.toISOString().slice(0, 10));
    prCountByWeek.set(wk, (prCountByWeek.get(wk) ?? 0) + 1);
  }
  for (const s of realPrSets.sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime())) {
    if (existingPrSetIds.has(s.id)) continue; // already awarded (idempotent no-op)
    const wk = weekStartIso(s.loggedAt.toISOString().slice(0, 10));
    const countThisWeek = prCountByWeek.get(wk) ?? 0;
    if (countThisWeek >= PR_XP_WEEKLY_CAP) continue; // cap reached — no XP, but the PR itself still stands
    prCountByWeek.set(wk, countThisWeek + 1);
    xpInserts.push({ kind: 'pr', sourceKey: s.id, amount: XP_AWARDS.pr });
  }

  if (xpInserts.length > 0) {
    await db
      .insert(xpEvents)
      .values(xpInserts.map((e) => ({ accountId, kind: e.kind, sourceKey: e.sourceKey, amount: e.amount })))
      .onConflictDoNothing({ target: [xpEvents.accountId, xpEvents.kind, xpEvents.sourceKey] });
  }

  const { bestE1RmByLift, lifetimeTonnageKg } = liftBestsAndTonnage(rankedSets);

  const prCount = realPrSets.length;

  const buddyIds = await acceptedBuddyIds(db, accountId);
  const hasBuddy = buddyIds.length > 0;

  // Distinct ISO weeks with a check-in — the crew check-in badges
  // (checkin_10/checkin_25) and rank gate are bounded per week, mirroring the
  // weekly check-in XP bound above (design law 1), not raw row counts.
  const checkInWeekCount = new Set(checkInRows.map((c) => weekStartIso(c.date))).size;

  const badgeInput: BadgeComputeInput = {
    bestE1RmByLift,
    lifetimeSessionDays,
    lifetimeTonnageKg,
    prCount,
    streakWeeksBest: bestStreakWeeks,
    sessionDayIsos,
    checkInCount: checkInWeekCount,
    hasBuddy,
  };

  const earnedBadgeIds = computeEarnedBadgeIds(badgeInput);

  const existingBadgeRows = await db
    .select({ badgeId: awardedBadges.badgeId })
    .from(awardedBadges)
    .where(eq(awardedBadges.accountId, accountId));
  const existingBadgeIds = new Set(existingBadgeRows.map((b) => b.badgeId));
  const newBadgeIds = earnedBadgeIds.filter((id) => !existingBadgeIds.has(id));

  if (newBadgeIds.length > 0) {
    await db
      .insert(awardedBadges)
      .values(newBadgeIds.map((badgeId) => ({ accountId, badgeId, status: 'logged' as const })))
      .onConflictDoNothing({ target: [awardedBadges.accountId, awardedBadges.badgeId] });
    // Bounded XP for each newly earned badge (sourceKey = badgeId).
    await db
      .insert(xpEvents)
      .values(
        newBadgeIds.map((badgeId) => ({
          accountId,
          kind: 'badge' as const,
          sourceKey: badgeId,
          amount: XP_AWARDS.badge,
        })),
      )
      .onConflictDoNothing({ target: [xpEvents.accountId, xpEvents.kind, xpEvents.sourceKey] });
  }

  // ── Coach challenge completion (current AND previous month, if joined) ───
  // Evaluating only the current month would silently lose a completion whose
  // final workout syncs after the month rolls over (offline retry, late-night
  // sync, or a UTC-negative timezone's local "still this month" being UTC
  // next month) — nothing ever re-evaluates a past month otherwise, so a
  // legitimately-earned challenge badge would be gone for good.
  const previousMonthKey = monthKeyOf(addDaysIso(`${monthKey}-01`, -1));
  const challengeRows = await db
    .select({
      id: coachChallenges.id,
      targetDays: coachChallenges.targetDays,
      monthKey: coachChallenges.monthKey,
    })
    .from(coachChallenges)
    .innerJoin(challengeMembers, eq(challengeMembers.challengeId, coachChallenges.id))
    .where(
      and(
        eq(challengeMembers.accountId, accountId),
        or(eq(coachChallenges.monthKey, monthKey), eq(coachChallenges.monthKey, previousMonthKey)),
      ),
    );
  for (const challenge of challengeRows) {
    const daysInChallengeMonth = new Set(
      allWorkouts
        .filter((w) => rankedWorkoutIds.has(w.id) && monthKeyOf(w.date) === challenge.monthKey)
        .map((w) => w.date),
    ).size;
    if (daysInChallengeMonth >= challenge.targetDays) {
      const challengeBadgeId = `challenge:${challenge.id}`;
      const inserted = await db
        .insert(awardedBadges)
        .values({ accountId, badgeId: challengeBadgeId, status: 'logged' })
        .onConflictDoNothing({ target: [awardedBadges.accountId, awardedBadges.badgeId] })
        .returning({ id: awardedBadges.id });
      if (inserted.length > 0) {
        newBadgeIds.push(challengeBadgeId);
        await db
          .insert(xpEvents)
          .values({ accountId, kind: 'badge', sourceKey: challengeBadgeId, amount: XP_AWARDS.badge })
          .onConflictDoNothing({ target: [xpEvents.accountId, xpEvents.kind, xpEvents.sourceKey] });
      }
    }
  }

  // ── Buddy co-op quest completion (both sides >= 12 session-days in the
  //    month, ranked only) — evaluated for current AND previous month for the
  //    same late-sync/timezone reason as coach challenges above, for every
  //    accepted buddy pair involving this account. Idempotent via
  //    buddyQuestAwards unique(month, pair). ────────────────────────────────
  await evaluateBuddyQuests(db, accountId, monthKey);
  await evaluateBuddyQuests(db, accountId, previousMonthKey);

  // Re-read the badge count AFTER every award path above (including the
  // buddy-quest pass, which can award directly and isn't reflected in
  // newBadgeIds) so `badges.earned` below is never stale by one on the exact
  // call that completes a quest.
  const finalBadgeCountRows = await db
    .select({ badgeId: awardedBadges.badgeId })
    .from(awardedBadges)
    .where(eq(awardedBadges.accountId, accountId));
  const finalBadgeCount = finalBadgeCountRows.filter((b) => !b.badgeId.startsWith('challenge:')).length;

  // ── Recompute cached profile row ─────────────────────────────────────────
  const xpTotalRows = await db
    .select({ amount: xpEvents.amount })
    .from(xpEvents)
    .where(eq(xpEvents.accountId, accountId));
  const xpTotal = xpTotalRows.reduce((sum, r) => sum + r.amount, 0);

  await db
    .update(gamificationProfiles)
    .set({
      xpTotal,
      streakWeeks: streak.weeks,
      bestStreakWeeks,
      updatedAt: new Date(),
    })
    .where(eq(gamificationProfiles.accountId, accountId));

  // ── Rank (rolling 90-day consistency + lifetime + check-ins) ─────────────
  const cutoff90 = addDaysIso(today, -90);
  const sessionDays90 = sessionDayIsos.filter((d) => d >= cutoff90).length;
  const checkIns90 = new Set(
    checkInRows.filter((c) => c.date >= cutoff90).map((c) => weekStartIso(c.date)),
  ).size;
  const rank = computeRank({
    sessionDays90,
    weeklyTargetDays,
    lifetimeSessionDays,
    checkIns90,
  });

  const lp = levelProgress(xpTotal);

  return {
    profile: {
      xpTotal,
      level: lp.level,
      xpIntoLevel: lp.xpIntoLevel,
      xpForNextLevel: lp.xpForNextLevel,
      rank,
      weeklyTargetDays,
    },
    streak: {
      weeks: streak.weeks,
      bestWeeks: bestStreakWeeks,
      thisWeekDays: streak.thisWeekDays,
      weekStart: streak.weekStart,
      shieldedWeekStarts,
    },
    shields: {
      quota,
      usedThisMonth,
      remaining: Math.max(0, quota - usedThisMonth),
    },
    badges: {
      earned: finalBadgeCount,
      total: BADGE_CATALOG.length,
    },
    newBadgeIds,
  };
}

// ── Stat derivations shared by the award engine and the badge-progress
//    snapshot below — ONE implementation so "earned" and "progress" can
//    never disagree about what counts. ─────────────────────────────────────

interface RankedSetRow {
  id: string;
  exerciseId: string;
  exerciseName: string;
  weightKg: number;
  reps: number;
  loggedAt: Date;
}

/**
 * PRs are derived SERVER-SIDE, never trusted from the client's `isPr` flag:
 * a set only counts as a PR if its e1RM strictly exceeds the account's
 * running best e1RM for that exerciseId at the time it was logged. Walking
 * ranked sets in chronological order and tracking a running best per
 * exercise makes this exact and un-farmable (the client flag has no
 * bearing on badge/XP credit at all).
 */
function walkRealPrSets(rankedSets: readonly RankedSetRow[]): { id: string; loggedAt: Date }[] {
  const realPrSets: { id: string; loggedAt: Date }[] = [];
  const runningBestByExercise = new Map<string, number>();
  for (const s of [...rankedSets].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime())) {
    const e1rm = epley1Rm(s.weightKg, s.reps);
    const prevBest = runningBestByExercise.get(s.exerciseId) ?? 0;
    if (e1rm > prevBest) {
      runningBestByExercise.set(s.exerciseId, e1rm);
      if (prevBest > 0) realPrSets.push({ id: s.id, loggedAt: s.loggedAt });
    }
  }
  return realPrSets;
}

/** Best e1RM per canonical big lift + lifetime volume, RANKED sets only. */
function liftBestsAndTonnage(rankedSets: readonly RankedSetRow[]): {
  bestE1RmByLift: BadgeComputeInput['bestE1RmByLift'];
  lifetimeTonnageKg: number;
} {
  const bestE1RmByLift: BadgeComputeInput['bestE1RmByLift'] = {};
  let lifetimeTonnageKg = 0;
  for (const s of rankedSets) {
    lifetimeTonnageKg += s.weightKg * s.reps;
    const lift = canonicalLift(s.exerciseId, s.exerciseName);
    if (!lift) continue;
    const e1rm = epley1Rm(s.weightKg, s.reps);
    if (e1rm > (bestE1RmByLift[lift] ?? 0)) bestE1RmByLift[lift] = e1rm;
  }
  return { bestE1RmByLift, lifetimeTonnageKg };
}

/**
 * Read-only stats snapshot for the badge-progress UI (locked-badge progress
 * bars on the caller's OWN badges screen — personal-only surface). Derived
 * with the exact same helpers the award engine uses, so a progress bar that
 * reads 100% is always an earned badge and vice versa.
 *
 * `streakWeeksBest` reads the cached profile value the engine maintains on
 * every run instead of recomputing the weekly walk — the badges screen loads
 * after home/settings has already run the engine, so the cache is fresh in
 * practice and only ever lags by one engine run at worst.
 *
 * Writes nothing — safe to call from any GET without award side effects.
 */
export async function computeBadgeStatsForAccount(
  db: Db,
  accountId: string,
): Promise<BadgeProgressStats> {
  const [workoutRows, setRows, checkInRows, profileRows, buddyIds] = await Promise.all([
    db
      .select({ id: syncedWorkouts.id, date: syncedWorkouts.date, ranked: syncedWorkouts.ranked })
      .from(syncedWorkouts)
      .where(eq(syncedWorkouts.accountId, accountId)),
    db
      .select({
        id: syncedSets.id,
        exerciseId: syncedSets.exerciseId,
        exerciseName: syncedSets.exerciseName,
        weightKg: syncedSets.weightKg,
        reps: syncedSets.reps,
        workoutId: syncedSets.workoutId,
        loggedAt: syncedSets.loggedAt,
      })
      .from(syncedSets)
      .where(eq(syncedSets.accountId, accountId)),
    db.select({ date: checkIns.date }).from(checkIns).where(eq(checkIns.accountId, accountId)),
    db
      .select({ bestStreakWeeks: gamificationProfiles.bestStreakWeeks })
      .from(gamificationProfiles)
      .where(eq(gamificationProfiles.accountId, accountId))
      .limit(1),
    acceptedBuddyIds(db, accountId),
  ]);

  // Lifetime session-days count ALL finished workouts (ranked + unranked),
  // mirroring the engine's badge input (design law 4); everything strength/
  // tonnage/PR-shaped is ranked-only.
  const lifetimeSessionDays = new Set(workoutRows.map((w) => w.date)).size;
  const rankedWorkoutIds = new Set(workoutRows.filter((w) => w.ranked).map((w) => w.id));
  const rankedSets = setRows.filter((s) => rankedWorkoutIds.has(s.workoutId));

  const { bestE1RmByLift, lifetimeTonnageKg } = liftBestsAndTonnage(rankedSets);

  return {
    bestE1RmByLift,
    lifetimeSessionDays,
    lifetimeTonnageKg,
    prCount: walkRealPrSets(rankedSets).length,
    streakWeeksBest: profileRows[0]?.bestStreakWeeks ?? 0,
    // Distinct ISO weeks with a check-in — same weekly bounding as the
    // engine's checkin_* badge input (design law 1).
    checkInCount: new Set(checkInRows.map((c) => weekStartIso(c.date))).size,
    hasBuddy: buddyIds.length > 0,
  };
}

/**
 * Checks every accepted-buddy pair involving `accountId` for this month's
 * "both log 12 session-days" co-op quest. Awards the `buddy_quest` badge to
 * BOTH sides + pushes both when a pair newly completes it. accountA/B are
 * stored lexicographically sorted so a pair has exactly one award row.
 */
async function evaluateBuddyQuests(db: Db, accountId: string, monthKey: string): Promise<void> {
  const links = await db
    .select({ requesterId: buddyLinks.requesterId, addresseeId: buddyLinks.addresseeId })
    .from(buddyLinks)
    .where(
      and(
        eq(buddyLinks.status, 'accepted'),
        or(eq(buddyLinks.requesterId, accountId), eq(buddyLinks.addresseeId, accountId)),
      ),
    );
  const buddyIds = links.map((l) => (l.requesterId === accountId ? l.addresseeId : l.requesterId));
  if (buddyIds.length === 0) return;

  const QUEST_TARGET = 12;
  const monthStart = `${monthKey}-01`;
  // Upper-bound the window to this month only — otherwise a future-dated
  // workout (client-supplied date, only regex-validated) would satisfy
  // gte(monthStart) in EVERY future month's evaluation forever.
  const monthEndExclusive = nextMonthStart(monthKey);

  for (const buddyId of buddyIds) {
    const [a, b] = accountId < buddyId ? [accountId, buddyId] : [buddyId, accountId];

    const already = await db
      .select({ id: buddyQuestAwards.id })
      .from(buddyQuestAwards)
      .where(
        and(
          eq(buddyQuestAwards.monthKey, monthKey),
          eq(buddyQuestAwards.accountA, a),
          eq(buddyQuestAwards.accountB, b),
        ),
      )
      .limit(1);
    if (already.length > 0) continue;

    const [mineDays, theirsDays] = await Promise.all([
      sessionDaysThisMonth(db, accountId, monthStart, monthEndExclusive),
      sessionDaysThisMonth(db, buddyId, monthStart, monthEndExclusive),
    ]);

    if (mineDays >= QUEST_TARGET && theirsDays >= QUEST_TARGET) {
      const inserted = await db
        .insert(buddyQuestAwards)
        .values({ monthKey, accountA: a, accountB: b })
        .onConflictDoNothing({
          target: [buddyQuestAwards.monthKey, buddyQuestAwards.accountA, buddyQuestAwards.accountB],
        })
        .returning({ id: buddyQuestAwards.id });
      if (inserted.length === 0) continue; // lost the race to a concurrent call

      for (const who of [accountId, buddyId]) {
        await db
          .insert(awardedBadges)
          .values({ accountId: who, badgeId: 'buddy_quest', status: 'logged' })
          .onConflictDoNothing({ target: [awardedBadges.accountId, awardedBadges.badgeId] });
        await db
          .insert(xpEvents)
          .values({ accountId: who, kind: 'badge', sourceKey: 'buddy_quest', amount: XP_AWARDS.badge })
          .onConflictDoNothing({ target: [xpEvents.accountId, xpEvents.kind, xpEvents.sourceKey] });
      }

      // B30 (WP-2): the buddy-quest completion push was removed — the Buddy
      // feature was deleted end-to-end (2026-07-17/18), so this send site
      // targeted a screen/deep-link that no longer exists. The badge + XP award
      // above still land (idempotent) for legacy pairs; there is simply no push.
    }
  }
}

/**
 * Distinct RANKED session-days for an account within [monthStart, monthEnd)
 * (yyyy-mm-01, exclusive upper bound). The upper bound matters: without it a
 * future-dated workout (client-supplied date) would count toward every
 * future month's leaderboard/quest/challenge progress forever.
 */
async function sessionDaysThisMonth(
  db: Db,
  accountId: string,
  monthStart: string,
  monthEndExclusive: string,
): Promise<number> {
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

/**
 * Batch rank computation for leaderboard surfaces (≤ ~51 accounts) — exactly
 * mirrors the single-account rank math in `runAwardEngineInner` (the
 * `computeRank` call near the end): trailing-90-day distinct session-days +
 * lifetime distinct session-days from ALL finished workouts (ranked AND
 * unranked — rank is a personal consistency measure, design law 4, so it
 * intentionally does NOT apply the ranked-only filter competitive surfaces
 * use for session-day SORTING), distinct check-in ISO weeks in the trailing
 * 90 days, and each account's weeklyTargetDays (default 3 when no
 * gamification profile row exists yet).
 *
 * Read-only: never awards XP/badges and never writes the profile cache — the
 * award engine remains the single write path.
 */
export async function bulkRanks(db: Db, accountIds: string[]): Promise<Map<string, Rank>> {
  const ranks = new Map<string, Rank>();
  if (accountIds.length === 0) return ranks;

  const today = todayIsoUtc();
  const cutoff90 = addDaysIso(today, -90);

  const [workoutRows, checkInRows, profileRows] = await Promise.all([
    db
      .select({ accountId: syncedWorkouts.accountId, date: syncedWorkouts.date })
      .from(syncedWorkouts)
      .where(inArray(syncedWorkouts.accountId, accountIds)),
    db
      .select({ accountId: checkIns.accountId, date: checkIns.date })
      .from(checkIns)
      .where(inArray(checkIns.accountId, accountIds)),
    db
      .select({
        accountId: gamificationProfiles.accountId,
        weeklyTargetDays: gamificationProfiles.weeklyTargetDays,
      })
      .from(gamificationProfiles)
      .where(inArray(gamificationProfiles.accountId, accountIds)),
  ]);

  const lifetimeDays = new Map<string, Set<string>>();
  const days90 = new Map<string, Set<string>>();
  for (const w of workoutRows) {
    let all = lifetimeDays.get(w.accountId);
    if (!all) lifetimeDays.set(w.accountId, (all = new Set()));
    all.add(w.date);
    if (w.date >= cutoff90) {
      let recent = days90.get(w.accountId);
      if (!recent) days90.set(w.accountId, (recent = new Set()));
      recent.add(w.date);
    }
  }

  // Check-ins are counted as distinct ISO weeks (mirrors checkIns90 in the
  // engine — bounded per week, not raw row counts).
  const checkInWeeks90 = new Map<string, Set<string>>();
  for (const c of checkInRows) {
    if (c.date < cutoff90) continue;
    let weeks = checkInWeeks90.get(c.accountId);
    if (!weeks) checkInWeeks90.set(c.accountId, (weeks = new Set()));
    weeks.add(weekStartIso(c.date));
  }

  const targetByAccount = new Map(profileRows.map((p) => [p.accountId, p.weeklyTargetDays]));

  for (const id of accountIds) {
    ranks.set(
      id,
      computeRank({
        sessionDays90: days90.get(id)?.size ?? 0,
        weeklyTargetDays: targetByAccount.get(id) ?? 3,
        lifetimeSessionDays: lifetimeDays.get(id)?.size ?? 0,
        checkIns90: checkInWeeks90.get(id)?.size ?? 0,
      }),
    );
  }
  return ranks;
}

export { BADGE_CATALOG };
