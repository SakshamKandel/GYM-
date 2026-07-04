import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { SetLog, WorkoutLog } from '@gym/shared';
import { getRepo } from '../../lib/repo';
import {
  compareSets,
  groupByExercise,
  groupByMonth,
  statsOfSets,
  type ExerciseGroup,
  type MonthSection,
  type VsLast,
  type WorkoutStats,
} from './logic';

/** Data hooks for the history browser. */

/** Generous ceiling — ~3 sessions/week for 3 years. */
const HISTORY_LIMIT = 500;
/** How many previous sessions the 'vs last time' search will walk back through. */
const COMPARE_LOOKBACK = 60;

/**
 * Per-workout stats survive navigation (index ↔ detail) so rows never
 * re-load. Safe to cache forever: sets are immutable once a workout is
 * finished, and deleted workouts simply stop being asked for.
 */
const statsCache = new Map<string, WorkoutStats>();

/** Drop a deleted workout's cached stats. */
export function forgetWorkoutStats(id: string): void {
  statsCache.delete(id);
}

export interface HistoryData {
  /** Month sections, newest first; null while the first load is in flight. */
  months: MonthSection[] | null;
  /** workoutId → stats; rows fill in month-by-month from the top. */
  stats: Record<string, WorkoutStats>;
}

/**
 * All finished workouts grouped by month, refreshed on focus. Row stats load
 * in per-month batches (newest month first) instead of one query per visible
 * row, and merge into state as each month resolves.
 */
export function useHistory(): HistoryData {
  const [months, setMonths] = useState<MonthSection[] | null>(null);
  const [stats, setStats] = useState<Record<string, WorkoutStats>>({});

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const workouts = await repo.getRecentWorkouts(HISTORY_LIMIT);
        if (!mounted) return;

        const sections = groupByMonth(workouts);
        const seeded: Record<string, WorkoutStats> = {};
        for (const w of workouts) {
          const cached = statsCache.get(w.id);
          if (cached) seeded[w.id] = cached;
        }
        setMonths(sections);
        setStats(seeded);

        for (const section of sections) {
          const missing = section.workouts.filter((w) => !statsCache.has(w.id));
          if (missing.length === 0) continue;
          const setLists = await Promise.all(missing.map((w) => repo.getSetsForWorkout(w.id)));
          if (!mounted) return;
          const patch: Record<string, WorkoutStats> = {};
          missing.forEach((w, i) => {
            const s = statsOfSets(setLists[i] ?? []);
            statsCache.set(w.id, s);
            patch[w.id] = s;
          });
          setStats((prev) => ({ ...prev, ...patch }));
        }
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );

  return { months, stats };
}

export type Comparison = { kind: 'first' } | ({ kind: 'compared' } & VsLast);

export interface WorkoutDetail {
  workout: WorkoutLog | null;
  /** True once the initial fetch has resolved (workout may still be null = gone). */
  loaded: boolean;
  stats: WorkoutStats | null;
  groups: ExerciseGroup[];
  /** exerciseId → comparison; keys appear once the lookback finishes. */
  vsLast: Record<string, Comparison>;
}

/**
 * One finished session in full, plus a 'vs last time' comparison per exercise
 * against the previous workout that included it. The lookback walks recent
 * workouts newest-first and fetches each one's sets at most once, stopping as
 * soon as every exercise has found its previous appearance.
 */
export function useWorkoutDetail(id: string | undefined): WorkoutDetail {
  const [workout, setWorkout] = useState<WorkoutLog | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<WorkoutStats | null>(null);
  const [groups, setGroups] = useState<ExerciseGroup[]>([]);
  const [vsLast, setVsLast] = useState<Record<string, Comparison>>({});

  useEffect(() => {
    if (id === undefined || id.length === 0) return;
    let mounted = true;
    void (async () => {
      const repo = await getRepo();
      const [w, sets] = await Promise.all([repo.getWorkout(id), repo.getSetsForWorkout(id)]);
      if (!mounted) return;

      const exerciseGroups = groupByExercise(sets);
      setWorkout(w);
      setStats(statsOfSets(sets));
      setGroups(exerciseGroups);
      setLoaded(true);
      if (w === null || exerciseGroups.length === 0) return;

      const recents = await repo.getRecentWorkouts(HISTORY_LIMIT);
      const candidates = recents
        .filter((p) => p.id !== w.id && p.startedAt < w.startedAt)
        .slice(0, COMPARE_LOOKBACK);

      const remaining = new Set(exerciseGroups.map((g) => g.exerciseId));
      const result: Record<string, Comparison> = {};
      for (const candidate of candidates) {
        if (remaining.size === 0) break;
        const candidateSets: SetLog[] = await repo.getSetsForWorkout(candidate.id);
        if (!mounted) return;
        for (const g of exerciseGroups) {
          if (!remaining.has(g.exerciseId)) continue;
          const previous = candidateSets.filter((s) => s.exerciseId === g.exerciseId);
          if (previous.length === 0) continue;
          remaining.delete(g.exerciseId);
          result[g.exerciseId] = { kind: 'compared', ...compareSets(g.sets, previous) };
        }
      }
      for (const exerciseId of remaining) result[exerciseId] = { kind: 'first' };
      if (mounted) setVsLast(result);
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  return { workout, loaded, stats, groups, vsLast };
}
