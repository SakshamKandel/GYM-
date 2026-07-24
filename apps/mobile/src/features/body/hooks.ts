import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { Measurement, PrRecord, WeightLog } from '@gym/shared';
import { getExercise } from '../../lib/exercises';
import { getRepo } from '../../lib/repo';
import { ensureTrainingCatalog } from '../../lib/trainingCatalog';
import { bestE1Rm } from './logic';

/** Focus-refreshing data hooks for the Progress tab (null = still loading). */

export function useWeights(): WeightLog[] | null {
  const [weights, setWeights] = useState<WeightLog[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const rows = await repo.getWeights(90);
        if (mounted) setWeights(rows);
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );
  return weights;
}

export interface StrengthRow {
  exerciseId: string;
  name: string;
  bestE1RmKg: number;
  history: { date: string; e1rm: number }[];
}

export interface StrengthData {
  rows: StrengthRow[];
  prs: PrRecord[];
}

export function useStrength(): StrengthData | null {
  const [data, setData] = useState<StrengthData | null>(null);
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        await ensureTrainingCatalog();
        const repo = await getRepo();
        const [ids, prs] = await Promise.all([repo.getRecentExerciseIds(10), repo.getPrRecords(15)]);
        const histories = await Promise.all(ids.map((id) => repo.getE1RmHistory(id, 30)));
        const rows: StrengthRow[] = [];
        ids.forEach((id, i) => {
          const history = histories[i] ?? [];
          const best = bestE1Rm(history);
          if (best === null) return; // nothing chartable for this exercise yet
          rows.push({
            exerciseId: id,
            name: getExercise(id)?.name ?? 'Exercise',
            bestE1RmKg: best,
            history,
          });
        });
        if (mounted) setData({ rows, prs });
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );
  return data;
}

export function useMeasurements(): Measurement[] | null {
  const [entries, setEntries] = useState<Measurement[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const rows = await repo.getMeasurements(30);
        if (mounted) setEntries(rows);
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );
  return entries;
}
