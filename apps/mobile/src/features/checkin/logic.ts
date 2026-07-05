import { addDays, todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';
import type { CheckInSummary } from './api';

/**
 * Weekly coach check-in rules: when the home card is due, and the auto-
 * attached week summary computed from local data. Client-triggered only —
 * nothing here schedules anything; the card simply checks on focus.
 */

/** A new check-in unlocks this many days after the last one. */
export const DUE_AFTER_DAYS = 7;

/** Summary window — mirrors the GM check-in's "this week" range. */
export const WEEK_DAYS = 7;

/**
 * Due when the member has never checked in, or the last check-in date is
 * ≥ 7 days ago. Dates are local-timezone yyyy-mm-dd strings (app convention),
 * so plain string comparison is correct.
 */
export function isCheckInDue(lastCheckInAt: string | null, today: string = todayIso()): boolean {
  return lastCheckInAt === null || lastCheckInAt <= addDays(today, -DUE_AFTER_DAYS);
}

/**
 * The week summary auto-attached to a check-in: finished sessions, total
 * volume (kg × reps, canonical kg) and PR count over the last 7 days —
 * computed from local SQLite so it works offline and costs no server round
 * trip. Failures bubble to the caller (the card falls back to zeros).
 */
export async function weekSummary(): Promise<CheckInSummary> {
  const repo = await getRepo();
  const to = todayIso();
  // -(WEEK_DAYS - 1): the window is inclusive on both ends, so -7 would span
  // 8 distinct dates and double-count a once-a-week schedule.
  const from = addDays(to, -(WEEK_DAYS - 1));
  const [workouts, sets] = await Promise.all([
    repo.getWorkoutsBetween(from, to),
    repo.getSetsBetween(from, to),
  ]);
  // Volume from the same finished-workouts set rows as the session and PR
  // counts (getVolumeBetween has no finished filter, so it would count an
  // in-progress workout's sets and let the three numbers disagree).
  const volumeKg = sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
  return {
    sessions: workouts.length,
    volumeKg: Math.round(volumeKg),
    prCount: sets.filter((s) => s.isPr).length,
  };
}
