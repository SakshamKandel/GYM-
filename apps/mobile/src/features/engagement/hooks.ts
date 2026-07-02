import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { PlanWorkout, Streak } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';
import { getNextPlanWorkout } from '../../lib/planProgress';
import { getPlan } from '../../lib/seed/plans';
import { useQuest } from '../../state/quest';
import {
  countFinished,
  prCountSince,
  questProgress,
  volumeOfSets,
  weekStartIso,
  type QuestProgress,
} from './logic';

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

/**
 * First-3-workouts activation quest. On focus it counts finished workouts since
 * the quest start day and returns pure `questProgress`. Returns null until the
 * count is loaded (and the start day has been anchored). Independent of
 * `useHomeData` so neither can break the other.
 */
export function useQuestProgress(): QuestProgress | null {
  const questStartIso = useQuest((s) => s.questStartIso);
  const ensureStarted = useQuest((s) => s.ensureStarted);
  const [progress, setProgress] = useState<QuestProgress | null>(null);

  useFocusEffect(
    useCallback(() => {
      // Anchor the window the first time the quest is ever observed.
      ensureStarted();
      const startIso = useQuest.getState().questStartIso;
      if (startIso === null) return;

      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        // The window is 14 days; a generous pull covers every finished session.
        const recents = await repo.getRecentWorkouts(50);
        const finished = recents.filter(
          (w) => w.finishedAt !== null && w.date >= startIso,
        ).length;
        if (!mounted) return;
        setProgress(questProgress(finished, startIso, todayIso()));
      })();
      return () => {
        mounted = false;
      };
    }, [ensureStarted, questStartIso]),
  );

  return progress;
}
