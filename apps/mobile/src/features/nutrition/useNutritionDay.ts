import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { FoodLog } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';
import { markedDatesFromKcal, stripDates } from './logic';

interface DayState {
  loaded: boolean;
  logs: FoodLog[];
  waterMl: number;
  /** Dates (within the day strip range) that have any food logged. */
  marked: Set<string>;
  /** Yesterday's logs — only fetched when `date` is today (Copy-yesterday shortcut). */
  yesterdayLogs: FoodLog[];
}

const EMPTY: DayState = {
  loaded: false,
  logs: [],
  waterMl: 0,
  marked: new Set(),
  yesterdayLogs: [],
};

/**
 * Everything the Food tab needs for one date. Reloads on focus (so the tab
 * updates after logging) and whenever the selected date changes.
 */
export function useNutritionDay(date: string): DayState & {
  addWater: (deltaMl: number) => Promise<void>;
  deleteLog: (id: string) => Promise<void>;
  /** Persist pre-built logs (e.g. yesterday's clones) then reload the day. */
  copyLogs: (cloned: FoodLog[]) => Promise<void>;
} {
  const [state, setState] = useState<DayState>(EMPTY);

  const load = useCallback(async (): Promise<DayState> => {
    const repo = await getRepo();
    const dates = stripDates();
    const [logs, waterMl, kcalByDate, yesterdayLogs] = await Promise.all([
      repo.getFoodLogs(date),
      repo.getWaterMl(date),
      repo.getKcalByDate(dates),
      date === todayIso() ? repo.getFoodLogs(addDays(date, -1)) : Promise.resolve<FoodLog[]>([]),
    ]);
    return { loaded: true, logs, waterMl, marked: markedDatesFromKcal(kcalByDate), yesterdayLogs };
  }, [date]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load().then((next) => {
        if (active) setState(next);
      });
      return () => {
        active = false;
      };
    }, [load]),
  );

  const addWater = useCallback(
    async (deltaMl: number) => {
      const repo = await getRepo();
      const total = await repo.addWater(date, deltaMl);
      setState((s) => ({ ...s, waterMl: total }));
    },
    [date],
  );

  const deleteLog = useCallback(
    async (id: string) => {
      const repo = await getRepo();
      await repo.deleteFoodLog(id);
      const next = await load();
      setState(next);
    },
    [load],
  );

  const copyLogs = useCallback(
    async (cloned: FoodLog[]) => {
      const repo = await getRepo();
      for (const log of cloned) await repo.logFood(log);
      const next = await load();
      setState(next);
    },
    [load],
  );

  return { ...state, addWater, deleteLog, copyLogs };
}
