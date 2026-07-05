import type { WorkoutLog } from '@gym/shared';
import { computeWeeklyStreak, restShieldQuota, type WeeklyStreakState } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';

/**
 * Thin, pure wrappers around @gym/shared's weekly-streak math for the mobile
 * offline-first display. The heavy lifting (Monday-week bucketing, shield
 * accounting) lives in the shared package so mobile and server can never
 * disagree — this file only shapes local SQLite data into its inputs.
 */

/** How far back local history is pulled to seed the streak walk (~60 weeks). */
export const STREAK_LOOKBACK_DAYS = 420;

/**
 * Distinct local dates (yyyy-mm-dd) of FINISHED workouts in [fromDate, toDate].
 * Design law 4: flagged/unranked workouts still count toward the user's own
 * streak — mobile has no concept of `ranked` locally, so every finished
 * workout counts here (matches the server's streak treatment exactly).
 */
export function sessionDayIsosFromWorkouts(workouts: readonly WorkoutLog[]): string[] {
  const days = new Set(
    workouts.filter((w) => w.finishedAt !== null).map((w) => w.date),
  );
  return [...days].sort();
}

/**
 * Local weekly-streak state as of today, given the full local session-day
 * history. `shieldedWeekStarts` comes from the server (mobile can't compute
 * shield eligibility offline — tier is server-authoritative, gotcha #1) and
 * defaults to empty so the offline-first read is still correct, just without
 * shield credit until the server snapshot merges in.
 */
export function localWeeklyStreak(
  sessionDayIsos: readonly string[],
  weeklyTarget: number,
  shieldedWeekStarts: readonly string[] = [],
): WeeklyStreakState {
  return computeWeeklyStreak(sessionDayIsos, weeklyTarget, todayIso(), shieldedWeekStarts);
}

/** Whole days left in the current week (Mon..Sun), including today. */
export function daysLeftInWeek(weekStart: string, today = todayIso()): number {
  const weekEnd = addDays(weekStart, 6);
  const from = new Date(`${today}T12:00:00`).getTime();
  const to = new Date(`${weekEnd}T12:00:00`).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000) + 1);
}

export { restShieldQuota };
export type { WeeklyStreakState };
