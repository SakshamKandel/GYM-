import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { PlanWorkout, Streak } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';
import { getNextPlanWorkout } from '../../lib/planProgress';
import { getPlan } from '../../lib/seed/plans';
import { countFinished, prCountSince, volumeOfSets, weekStartIso } from './logic';

/** Everything the home dashboard needs, refreshed every time the tab focuses. */

export interface DoneToday {
  name: string;
  volumeKg: number;
}

export interface LastSession {
  name: string;
  date: string;
  volumeKg: number;
  sets: number;
}

export interface HomeData {
  streak: Streak;
  planName: string | null;
  nextWorkout: PlanWorkout | null;
  doneToday: DoneToday | null;
  weekVolumeKg: number;
  weekSessions: number;
  prCount: number;
  kcalEaten: number;
  lastSession: LastSession | null;
}

export function useHomeData(planId: string | null): HomeData | null {
  const [data, setData] = useState<HomeData | null>(null);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const today = todayIso();
        const monday = weekStartIso(today);

        const [streak, nextWorkout, todays, weekWorkouts, weekVolumeKg, prs, kcalByDate, recents] =
          await Promise.all([
            repo.getStreak(),
            planId ? getNextPlanWorkout(repo, planId) : Promise.resolve(null),
            repo.getWorkoutsBetween(today, today),
            repo.getWorkoutsBetween(monday, today),
            repo.getVolumeBetween(monday, today),
            repo.getPrRecords(100),
            repo.getKcalByDate([today]),
            repo.getRecentWorkouts(10),
          ]);

        const doneWorkout =
          [...todays]
            .filter((w) => w.finishedAt !== null)
            .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0] ?? null;
        let doneToday: DoneToday | null = null;
        if (doneWorkout) {
          const sets = await repo.getSetsForWorkout(doneWorkout.id);
          doneToday = { name: doneWorkout.name, volumeKg: volumeOfSets(sets) };
        }

        const lastFinished = recents.find((w) => w.finishedAt !== null) ?? null;
        let lastSession: LastSession | null = null;
        if (lastFinished) {
          const sets = await repo.getSetsForWorkout(lastFinished.id);
          lastSession = {
            name: lastFinished.name,
            date: lastFinished.date,
            volumeKg: volumeOfSets(sets),
            sets: sets.length,
          };
        }

        if (!mounted) return;
        setData({
          streak,
          planName: planId ? (getPlan(planId)?.name ?? null) : null,
          nextWorkout,
          doneToday,
          weekVolumeKg,
          weekSessions: countFinished(weekWorkouts),
          prCount: prCountSince(prs, addDays(today, -30)),
          kcalEaten: Math.round(kcalByDate[today] ?? 0),
          lastSession,
        });
      })();
      return () => {
        mounted = false;
      };
    }, [planId]),
  );

  return data;
}
