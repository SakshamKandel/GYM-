import type { ProgressionInput, ProgressionSession } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';
import type { AnalyticsSet } from '../../lib/repo/types';
import { useProfile } from '../../state/profile';
import { parseRepRange } from '../training/logic';

/**
 * Local history → pure engine input. The @gym/shared progression engine is
 * I/O-free by design; this module does the repo reads and shaping so both the
 * logging-flow hook and the post-sync submitter feed it identically.
 */

/** How far back suggestions look. Older sessions say little about today's strength. */
export const HISTORY_DAYS = 60;

/** The minimum an engine caller must know about an exercise. */
export interface EngineExercise {
  exerciseId: string;
  exerciseName: string;
  /** Template rep-range string ("8-12"), or null → engine default 8–12. */
  repRange: string | null;
}

/**
 * Group one exercise's analytics sets into engine sessions — one per workout
 * date, oldest first (getSetsBetween is already date-ordered; the engine
 * re-sorts defensively anyway). No warmup filter: local sets carry no warmup
 * flag yet, so every logged set is a working set.
 */
export function sessionsForExercise(
  sets: AnalyticsSet[],
  exerciseId: string,
): ProgressionSession[] {
  const byDate = new Map<string, ProgressionSession>();
  for (const s of sets) {
    if (s.exerciseId !== exerciseId) continue;
    let session = byDate.get(s.workoutDate);
    if (!session) {
      session = { date: s.workoutDate, sets: [] };
      byDate.set(s.workoutDate, session);
    }
    session.sets.push({ weightKg: s.weightKg, reps: s.reps, rpe: s.rpe });
  }
  return [...byDate.values()];
}

/**
 * Assemble the engine input from pre-fetched history (no I/O — submit.ts
 * reuses one repo read across every exercise in a synced batch). unitPref
 * only shapes the reason string; targets stay canonical kg.
 */
export function progressionInputFromSets(
  sets: AnalyticsSet[],
  exercise: EngineExercise,
): ProgressionInput {
  const range = parseRepRange(exercise.repRange);
  return {
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exerciseName,
    sessions: sessionsForExercise(sets, exercise.exerciseId),
    ...(range ? { repRangeMin: range.min, repRangeMax: range.max } : {}),
    unitPref: useProfile.getState().unitPref,
  };
}

/**
 * History read shared by every exercise in ONE open workout.
 *
 * The suggestion for a single exercise needs `HISTORY_DAYS` of that exercise's
 * sets, but the repo can only hand back the whole window, and the logger asks
 * again every time the member moves to another exercise — so an hour in the
 * gym re-read tens of thousands of rows to shape a few dozen.
 *
 * `getSetsBetween` only ever returns sets from FINISHED workouts, so while a
 * workout is open its answer cannot change. Keying the window on the open
 * workout's id (plus the dates it was read for, so a session running past
 * midnight re-reads) makes every switch after the first one free, with no
 * chance of serving one member's history to another: workout ids are unique
 * per account, so a different account simply misses the cache.
 */
let historyCache: { key: string; sets: AnalyticsSet[] } | null = null;

/** Drop the cached window. Called on sign-out; also safe to call any time. */
export function clearProgressionHistoryCache(): void {
  historyCache = null;
}

/** Fetch the last HISTORY_DAYS of finished-workout history and build the input. */
export async function buildProgressionInput(
  exercise: EngineExercise,
): Promise<ProgressionInput> {
  const repo = await getRepo();
  const to = todayIso();
  const from = addDays(to, -HISTORY_DAYS);
  const activeWorkoutId = (await repo.getActiveWorkout())?.id ?? null;
  // No workout open (a cold suggestion, the post-sync submitter): nothing
  // stable to key on, so read fresh and keep nothing.
  if (activeWorkoutId === null) {
    historyCache = null;
    return progressionInputFromSets(await repo.getSetsBetween(from, to), exercise);
  }
  const key = `${activeWorkoutId}|${from}|${to}`;
  if (historyCache === null || historyCache.key !== key) {
    historyCache = { key, sets: await repo.getSetsBetween(from, to) };
  }
  return progressionInputFromSets(historyCache.sets, exercise);
}
