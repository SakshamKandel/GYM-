import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { PlanWorkout, WorkoutLog } from '@gym/shared';
import { getNextPlanWorkout } from '../../lib/planProgress';
import { getRepo } from '../../lib/repo';

/** Small data hooks — refresh on focus so tabs update after logging. */

export interface TrainData {
  nextWorkout: PlanWorkout | null;
  activeWorkout: WorkoutLog | null;
  loaded: boolean;
}

export function useTrainData(planId: string): TrainData {
  const [data, setData] = useState<TrainData>({
    nextWorkout: null,
    activeWorkout: null,
    loaded: false,
  });

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const [nextWorkout, activeWorkout] = await Promise.all([
          getNextPlanWorkout(repo, planId),
          repo.getActiveWorkout(),
        ]);
        if (mounted) setData({ nextWorkout, activeWorkout, loaded: true });
      })();
      return () => {
        mounted = false;
      };
    }, [planId]),
  );

  return data;
}

export interface ExerciseHistory {
  bestE1Rm: number | null;
  /** Most recent sessions first, max 3: best e1RM per workout date. */
  recentSessions: { date: string; e1rm: number }[];
  loaded: boolean;
}

export function useExerciseHistory(exerciseId: string): ExerciseHistory {
  const [data, setData] = useState<ExerciseHistory>({
    bestE1Rm: null,
    recentSessions: [],
    loaded: false,
  });

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const [bestE1Rm, history] = await Promise.all([
          repo.getBestE1Rm(exerciseId, ''),
          repo.getE1RmHistory(exerciseId, 3),
        ]);
        if (mounted) {
          setData({ bestE1Rm, recentSessions: [...history].reverse(), loaded: true });
        }
      })();
      return () => {
        mounted = false;
      };
    }, [exerciseId]),
  );

  return data;
}
