/**
 * Weekly-frequency streak math — pure, unit-tested (CLAUDE.md rule 10).
 *
 * Streaks count WEEKS, never days (lifters need rest days — gamification
 * design law 3). A week counts when distinct session-days in that Monday-
 * start week >= the user's weekly target, OR the week was covered by a Rest
 * Shield. Weeks are keyed by the workout's stored LOCAL date string via
 * `weekStartIso` — never convert timestamps to UTC dates (gotcha #2).
 */

import type { Tier } from '../types';
import { weekStartIso } from './analytics';

export interface WeeklyStreakState {
  /** Consecutive counted weeks, ending at (and possibly including) the current week. */
  weeks: number;
  bestWeeks: number;
  /** Distinct session-days so far in the current week. */
  thisWeekDays: number;
  /** Monday of the current week (yyyy-mm-dd). */
  weekStart: string;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Distinct-day count within [weekStart, weekStart+6] from a day-count map. */
function daysInWeek(dayCounts: Map<string, number>, weekStart: string): number {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    if (dayCounts.has(addDaysIso(weekStart, i))) count++;
  }
  return count;
}

/**
 * Weekly streak state as of `todayIso`.
 *
 * `sessionDayIsos` are DISTINCT yyyy-mm-dd dates of FINISHED workouts —
 * ranked AND unranked both count (design law 4: flagged workouts still count
 * toward the user's own streak, they only drop out of competitive surfaces).
 *
 * The current week never breaks the streak while it's still incomplete and
 * in progress — only fully-elapsed past weeks are judged pass/fail. A past
 * week counts if its distinct-day total >= weeklyTarget OR its Monday is in
 * `shieldedWeekStarts`.
 */
export function computeWeeklyStreak(
  sessionDayIsos: readonly string[],
  weeklyTarget: number,
  todayIso: string,
  shieldedWeekStarts: readonly string[],
): WeeklyStreakState {
  const target = Math.max(1, weeklyTarget);
  const dayCounts = new Map<string, number>();
  for (const day of sessionDayIsos) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);

  const currentWeekStart = weekStartIso(todayIso);
  const thisWeekDays = daysInWeek(dayCounts, currentWeekStart);
  const shieldSet = new Set(shieldedWeekStarts);

  // Walk backwards week-by-week from the week before the current one,
  // counting consecutive counted weeks until we hit a miss.
  let weeks = 0;
  let cursor = addDaysIso(currentWeekStart, -7);
  // Bound the walk so a sparse/empty history doesn't loop forever — 10 years
  // of weekly history is far beyond any real streak.
  const MAX_WEEKS_BACK = 520;
  for (let i = 0; i < MAX_WEEKS_BACK; i++) {
    const met = daysInWeek(dayCounts, cursor) >= target || shieldSet.has(cursor);
    if (!met) break;
    weeks++;
    cursor = addDaysIso(cursor, -7);
  }

  // The current week contributes to the visible streak count once it has
  // already met target (so hitting the goal mid-week shows the bump right
  // away), but never breaks it while short.
  const currentWeekCounts = thisWeekDays >= target || shieldSet.has(currentWeekStart);
  if (currentWeekCounts) weeks++;

  return {
    weeks,
    bestWeeks: weeks, // caller merges with server-cached bestStreakWeeks; see gotcha notes
    thisWeekDays,
    weekStart: currentWeekStart,
  };
}

/** Rest Shield monthly quota by effective tier (server-authoritative — gotcha #1). */
export function restShieldQuota(tier: Tier): number {
  switch (tier) {
    case 'gold':
      return 1;
    case 'elite':
      return 2;
    default:
      return 0;
  }
}

export interface PlanShieldUseArgs {
  sessionDayIsos: readonly string[];
  weeklyTarget: number;
  todayIso: string;
  existingUses: readonly { weekStart: string; monthKey: string }[];
  quotaPerMonth: number;
}

/**
 * Minimum days after a week's Monday before the server is willing to judge
 * that week "safely elapsed" and eligible for auto-shielding. `todayIso` is
 * always server UTC, but a missed week's session-days come from the client's
 * LOCAL date strings — a user west of UTC can still be mid-week locally while
 * the server's UTC clock has already rolled into the next week. Requiring a
 * full extra day of buffer (the week's 7 days + 1) means the week is only
 * shielded once it is unambiguously over even for timezones behind UTC.
 */
const SAFE_ELAPSED_BUFFER_DAYS = 8;

export interface ShieldPlan {
  weekStart: string;
  monthKey: string;
}

/** 'yyyy-mm' month key containing a Monday-start week's date. */
function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Which past, missed weeks (excluding the current, still-in-progress week)
 * should be auto-covered by a Rest Shield, respecting the per-calendar-month
 * quota and shields already used. Returns newest-missed-week first so the
 * caller can apply them in priority order (most recent gap first preserves
 * the longest possible streak tail).
 *
 * A week's shield draws from the quota of the calendar month CONTAINING that
 * week's Monday (`monthKey`), matching `restShieldUses.monthKey`.
 */
export function planShieldUse(args: PlanShieldUseArgs): ShieldPlan[] {
  const target = Math.max(1, args.weeklyTarget);
  const dayCounts = new Map<string, number>();
  for (const day of args.sessionDayIsos) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);

  const usedWeekStarts = new Set(args.existingUses.map((u) => u.weekStart));
  const usesPerMonth = new Map<string, number>();
  for (const u of args.existingUses) {
    usesPerMonth.set(u.monthKey, (usesPerMonth.get(u.monthKey) ?? 0) + 1);
  }

  const currentWeekStart = weekStartIso(args.todayIso);
  const plans: ShieldPlan[] = [];
  const MAX_WEEKS_BACK = 520;

  // Last safely-elapsed week (inclusive) the walk is allowed to judge — a
  // week is only fully in the past (even for a user behind UTC) once at
  // least SAFE_ELAPSED_BUFFER_DAYS have passed since its Monday.
  const lastJudgeableWeek = addDaysIso(args.todayIso, -SAFE_ELAPSED_BUFFER_DAYS);

  /** True if there is any met/shielded week strictly older than `weekStart` within the judgeable window (a real streak behind the gap worth protecting). */
  function hasMetOrShieldedWeekBehind(weekStart: string): boolean {
    let probe = addDaysIso(weekStart, -7);
    for (let i = 0; i < MAX_WEEKS_BACK && probe <= lastJudgeableWeek; i++) {
      if (daysInWeek(dayCounts, probe) >= target || usedWeekStarts.has(probe)) return true;
      probe = addDaysIso(probe, -7);
    }
    return false;
  }

  let cursor = addDaysIso(currentWeekStart, -7);
  for (let i = 0; i < MAX_WEEKS_BACK; i++) {
    // Only judge a week once it is safely elapsed.
    if (cursor > lastJudgeableWeek) break;

    const met = daysInWeek(dayCounts, cursor) >= target;
    if (met) {
      // A week that already meets target on its own needs no shield; keep
      // walking back only while the chain is unbroken (met OR shieldable).
      cursor = addDaysIso(cursor, -7);
      continue;
    }
    if (usedWeekStarts.has(cursor)) {
      // Already shielded previously — chain continues.
      cursor = addDaysIso(cursor, -7);
      continue;
    }
    // A missed week only protects a real streak if there's a met/shielded
    // week somewhere behind it (chronologically older) to connect to —
    // otherwise this is a brand-new/inactive user's first gap, and shielding
    // it would waste the month's quota protecting nothing.
    if (!hasMetOrShieldedWeekBehind(cursor)) break;
    const monthKey = monthKeyOf(cursor);
    const usedThisMonth = usesPerMonth.get(monthKey) ?? 0;
    if (usedThisMonth >= args.quotaPerMonth) break; // out of quota — chain (and streak) ends here
    plans.push({ weekStart: cursor, monthKey });
    usesPerMonth.set(monthKey, usedThisMonth + 1);
    cursor = addDaysIso(cursor, -7);
  }

  return plans;
}
