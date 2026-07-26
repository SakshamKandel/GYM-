import {
  accounts,
  awardedBadges,
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
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
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
 * coachPicks/coachChallenges unique(coachId,monthKey) — every insert here uses
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
 * cache, Rest Shield auto-consumption, badge awards, and coach-challenge
 * completions. Safe to call as often as needed.
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
  // Coach challenge completion is evaluated for the current AND previous month,
  // if joined — see the note further down for why a past month is re-checked.
  const previousMonthKey = monthKeyOf(addDaysIso(`${monthKey}-01`, -1));

  // ── Every read the rules examine, in ONE round trip ──────────────────────
  // These nine reads have no dependency on each other (the joins and filters
  // between them are all pure JS below), so they used to cost nine sequential
  // waits inside a function that already ran on every gamification read, every
  // sync ingest and every check-in. Batched, the wait is one.
  const [
    accountRows,
    profileRows,
    allWorkouts,
    existingShields,
    checkInRows,
    rankedSetRows,
    xpRows,
    existingBadgeRows,
    challengeRows,
  ] = await db.batch([
    db
      .select({ tier: accounts.tier, tierExpiresAt: accounts.tierExpiresAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1),
    db
      .select({
        weeklyTargetDays: gamificationProfiles.weeklyTargetDays,
        bestStreakWeeks: gamificationProfiles.bestStreakWeeks,
      })
      .from(gamificationProfiles)
      .where(eq(gamificationProfiles.accountId, accountId))
      .limit(1),
    // ALL finished workouts (ranked + unranked — streak/day_one/comeback use
    // all finished sessions per design law 4).
    db
      .select({
        id: syncedWorkouts.id,
        date: syncedWorkouts.date,
        ranked: syncedWorkouts.ranked,
      })
      .from(syncedWorkouts)
      .where(eq(syncedWorkouts.accountId, accountId)),
    db
      .select({ weekStart: restShieldUses.weekStart, monthKey: restShieldUses.monthKey })
      .from(restShieldUses)
      .where(eq(restShieldUses.accountId, accountId)),
    db
      .select({ id: checkIns.id, date: checkIns.date })
      .from(checkIns)
      .where(eq(checkIns.accountId, accountId)),
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
    // The whole XP ledger, ONCE. It answers three questions that each used to
    // cost their own statement: which PR sets have already been paid (the
    // weekly cap counts against history), which ledger keys exist at all (so a
    // re-run inserts only what is genuinely new instead of re-offering every
    // day the member has ever trained), and the running total.
    db
      .select({ kind: xpEvents.kind, sourceKey: xpEvents.sourceKey, amount: xpEvents.amount })
      .from(xpEvents)
      .where(eq(xpEvents.accountId, accountId)),
    db
      .select({ badgeId: awardedBadges.badgeId })
      .from(awardedBadges)
      .where(eq(awardedBadges.accountId, accountId)),
    db
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
      ),
  ]);

  const account = accountRows[0];
  if (!account) throw new Error(`account not found: ${accountId}`);

  const tier = effectiveTier(account.tier, account.tierExpiresAt, new Date());

  let profile = profileRows[0];
  if (!profile) {
    const inserted = await db
      .insert(gamificationProfiles)
      .values({ accountId })
      .onConflictDoNothing({ target: gamificationProfiles.accountId })
      .returning({
        weeklyTargetDays: gamificationProfiles.weeklyTargetDays,
        bestStreakWeeks: gamificationProfiles.bestStreakWeeks,
      });
    profile =
      inserted[0] ??
      (
        await db
          .select({
            weeklyTargetDays: gamificationProfiles.weeklyTargetDays,
            bestStreakWeeks: gamificationProfiles.bestStreakWeeks,
          })
          .from(gamificationProfiles)
          .where(eq(gamificationProfiles.accountId, accountId))
          .limit(1)
      )[0];
  }
  const weeklyTargetDays = profile?.weeklyTargetDays ?? 3;

  const sessionDayIsos = [...new Set(allWorkouts.map((w) => w.date))].sort();
  const rankedWorkoutIds = new Set(allWorkouts.filter((w) => w.ranked).map((w) => w.id));
  const lifetimeSessionDays = sessionDayIsos.length;

  // ── Existing Rest Shield uses + plan new ones ────────────────────────────
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
  // Everything on record = what was already there plus what this run just
  // planned. `planShieldUse` never plans a week that is already used, so the two
  // lists are disjoint and their concatenation is exactly what the re-read used
  // to return — one round trip cheaper, and cheapest of all on the overwhelming
  // majority of runs, where nothing new is planned at all.
  const shieldRows = [
    ...existingShields,
    ...planned.map((p) => ({ weekStart: p.weekStart, monthKey: p.monthKey })),
  ];
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

  // The ledger keys already on record. The insert below is idempotent either
  // way (unique on accountId+kind+sourceKey, ON CONFLICT DO NOTHING), so this
  // changes nothing about what the ledger ends up holding — it just stops the
  // engine re-offering every day the member has ever trained, every single
  // read. A long-standing member was shipping thousands of rows per call for
  // the database to throw away.
  const existingXpKeys = new Set(xpRows.map((e) => `${e.kind}:${e.sourceKey}`));
  const existingXpTotal = xpRows.reduce((sum, r) => sum + r.amount, 0);
  const addXp = (
    kind: 'daily_workout' | 'streak_week' | 'checkin' | 'pr',
    sourceKey: string,
    amount: number,
  ): void => {
    if (existingXpKeys.has(`${kind}:${sourceKey}`)) return;
    xpInserts.push({ kind, sourceKey, amount });
  };

  for (const day of sessionDayIsos) {
    addXp('daily_workout', day, XP_AWARDS.daily_workout);
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
    // Stop at the member's own history rather than always walking ten years
    // back. A week earlier than both their first session and their first shield
    // can be neither met nor shielded, so those iterations only ever decided
    // "no" — the weeks the walk still judges, and the answers it gives for
    // them, are unchanged.
    const historyWeeks = [
      ...(sessionDayIsos.length > 0 ? [weekStartIso(sessionDayIsos[0])] : []),
      ...shieldedWeekStarts,
    ].sort();
    const oldestWeek = historyWeeks.length > 0 ? historyWeeks[0] : null;
    for (let i = 0; i < MAX_WEEKS_BACK && oldestWeek !== null && cursor >= oldestWeek; i++) {
      let daysInWeek = 0;
      for (let d = 0; d < 7; d++) {
        if (dayCounts.has(addDaysIso(cursor, d))) daysInWeek++;
      }
      const met = daysInWeek >= weeklyTargetDays || shieldSet.has(cursor);
      if (met) {
        addXp('streak_week', cursor, XP_AWARDS.streak_week);
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
  const checkInWeeksAwarded = new Set<string>();
  for (const c of checkInRows.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const wk = weekStartIso(c.date);
    if (checkInWeeksAwarded.has(wk)) continue;
    checkInWeeksAwarded.add(wk);
    addXp('checkin', wk, XP_AWARDS.checkin);
  }

  // ── Badges: build BadgeComputeInput from RANKED workouts/sets (except
  //    day_one/comeback which use all finished sessions per contract) ──────
  const rankedSets = rankedSetRows.filter((s) => rankedWorkoutIds.has(s.workoutId));

  const realPrSets = walkRealPrSets(rankedSets);

  // PRs → XP, capped PR_XP_WEEKLY_CAP per ISO week (sourceKey = setId)
  const prCountByWeek = new Map<string, number>();
  // Already-awarded PR xp events this account has (so the cap counts against
  // history, not just this run) — read with the rest of the ledger above.
  const existingPrSetIds = new Set(
    xpRows.filter((e) => e.kind === 'pr').map((e) => e.sourceKey),
  );
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
    addXp('pr', s.id, XP_AWARDS.pr);
  }

  if (xpInserts.length > 0) {
    await db
      .insert(xpEvents)
      .values(xpInserts.map((e) => ({ accountId, kind: e.kind, sourceKey: e.sourceKey, amount: e.amount })))
      .onConflictDoNothing({ target: [xpEvents.accountId, xpEvents.kind, xpEvents.sourceKey] });
  }

  const { bestE1RmByLift, lifetimeTonnageKg } = liftBestsAndTonnage(rankedSets);

  const prCount = realPrSets.length;

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
  };

  const earnedBadgeIds = computeEarnedBadgeIds(badgeInput);

  const existingBadgeIds = new Set(existingBadgeRows.map((b) => b.badgeId));
  const newBadgeIds = earnedBadgeIds.filter((id) => !existingBadgeIds.has(id));

  /** Badge XP this run adds on top of the ledger it read (fallback total only). */
  let awardedBadgeXp = 0;

  if (newBadgeIds.length > 0) {
    awardedBadgeXp +=
      newBadgeIds.filter((id) => !existingXpKeys.has(`badge:${id}`)).length * XP_AWARDS.badge;
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
        if (!existingXpKeys.has(`badge:${challengeBadgeId}`)) awardedBadgeXp += XP_AWARDS.badge;
        await db
          .insert(xpEvents)
          .values({ accountId, kind: 'badge', sourceKey: challengeBadgeId, amount: XP_AWARDS.badge })
          .onConflictDoNothing({ target: [xpEvents.accountId, xpEvents.kind, xpEvents.sourceKey] });
      }
    }
  }

  // Counted AFTER every award path above so `badges.earned` is never stale by
  // one on the exact call that awards a badge: what is on record now is what
  // was on record when this run started, plus whatever it just awarded (both
  // sets are already in hand, so this no longer costs a re-read).
  const finalBadgeCount = [...new Set([...existingBadgeIds, ...newBadgeIds])].filter(
    (badgeId) => !badgeId.startsWith('challenge:'),
  ).length;

  // ── Recompute cached profile row ─────────────────────────────────────────
  // The total is summed IN the update, so the ledger is never shipped here just
  // to be added up, and the read and the write can no longer disagree.
  const updatedProfile = await db
    .update(gamificationProfiles)
    .set({
      xpTotal: sql<number>`(select coalesce(sum(${xpEvents.amount}), 0) from ${xpEvents} where ${xpEvents.accountId} = ${accountId})`,
      streakWeeks: streak.weeks,
      bestStreakWeeks,
      updatedAt: new Date(),
    })
    .where(eq(gamificationProfiles.accountId, accountId))
    .returning({ xpTotal: gamificationProfiles.xpTotal });
  // No profile row to update (only possible if it was deleted mid-run): fall
  // back to what this run knows — the ledger it read plus what it just awarded.
  const xpTotal =
    updatedProfile[0]?.xpTotal ??
    existingXpTotal + xpInserts.reduce((sum, e) => sum + e.amount, 0) + awardedBadgeXp;

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
): Promise<BadgeProgressStats & { hasBuddy: false }> {
  const [workoutRows, setRows, checkInRows, profileRows] = await Promise.all([
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
    // Wire compatibility only: `hasBuddy` was dropped from BadgeProgressStats
    // when the Buddy feature was deleted, but shipped mobile builds validate
    // this payload with a schema that still REQUIRES the key — omitting it
    // makes their whole stats object fail to parse, which silently hides every
    // locked-badge progress bar. Always false now; safe to delete once those
    // builds are out of circulation.
    hasBuddy: false,
  };
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

  // Only two numbers per account come out of the workout history — the distinct
  // session-days in the trailing 90 days and over the member's lifetime — so
  // both are counted in Postgres. Pulling the raw rows to count them in Node
  // meant a leaderboard load shipped the ENTIRE training history of all fifty
  // leaders (tens of thousands of rows on a busy gym) to produce fifty numbers.
  const [dayCountRows, checkInRows, profileRows] = await Promise.all([
    db
      .select({
        accountId: syncedWorkouts.accountId,
        lifetimeDays: sql<number>`count(distinct ${syncedWorkouts.date})`.mapWith(Number),
        days90: sql<number>`count(distinct ${syncedWorkouts.date}) filter (where ${syncedWorkouts.date} >= ${cutoff90})`.mapWith(
          Number,
        ),
      })
      .from(syncedWorkouts)
      .where(inArray(syncedWorkouts.accountId, accountIds))
      .groupBy(syncedWorkouts.accountId),
    // Check-ins older than the cutoff were read and then thrown away; the rank
    // rule only ever looks at the trailing 90 days.
    db
      .select({ accountId: checkIns.accountId, date: checkIns.date })
      .from(checkIns)
      .where(and(inArray(checkIns.accountId, accountIds), gte(checkIns.date, cutoff90))),
    db
      .select({
        accountId: gamificationProfiles.accountId,
        weeklyTargetDays: gamificationProfiles.weeklyTargetDays,
      })
      .from(gamificationProfiles)
      .where(inArray(gamificationProfiles.accountId, accountIds)),
  ]);

  const dayCounts = new Map(dayCountRows.map((r) => [r.accountId, r]));

  // Check-ins are counted as distinct ISO weeks (mirrors checkIns90 in the
  // engine — bounded per week, not raw row counts).
  const checkInWeeks90 = new Map<string, Set<string>>();
  for (const c of checkInRows) {
    let weeks = checkInWeeks90.get(c.accountId);
    if (!weeks) checkInWeeks90.set(c.accountId, (weeks = new Set()));
    weeks.add(weekStartIso(c.date));
  }

  const targetByAccount = new Map(profileRows.map((p) => [p.accountId, p.weeklyTargetDays]));

  for (const id of accountIds) {
    ranks.set(
      id,
      computeRank({
        sessionDays90: dayCounts.get(id)?.days90 ?? 0,
        weeklyTargetDays: targetByAccount.get(id) ?? 3,
        lifetimeSessionDays: dayCounts.get(id)?.lifetimeDays ?? 0,
        checkIns90: checkInWeeks90.get(id)?.size ?? 0,
      }),
    );
  }
  return ranks;
}

export { BADGE_CATALOG };
