import type { Streak } from '../types';

/** Streak math — pure. A streak survives up to `graceDays` between workouts. */

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

/**
 * Update a streak after completing a workout on `workoutDate`.
 * Default grace = 2 (train every ~3rd day keeps it alive — sustainable for 40+,
 * not a guilt engine). Same-day repeat workouts don't double-count.
 */
export function updateStreak(prev: Streak, workoutDate: string, graceDays = 2): Streak {
  if (prev.lastWorkoutDate === null) {
    return { current: 1, best: Math.max(1, prev.best), lastWorkoutDate: workoutDate };
  }
  const gap = daysBetween(prev.lastWorkoutDate, workoutDate);
  if (gap <= 0) return prev; // same day or out-of-order backfill
  const current = gap <= graceDays + 1 ? prev.current + 1 : 1;
  return { current, best: Math.max(current, prev.best), lastWorkoutDate: workoutDate };
}

/** Is the streak still alive as of `today` (no workout yet today)? */
export function streakAlive(streak: Streak, today: string, graceDays = 2): boolean {
  if (streak.lastWorkoutDate === null || streak.current === 0) return false;
  return daysBetween(streak.lastWorkoutDate, today) <= graceDays + 1;
}
