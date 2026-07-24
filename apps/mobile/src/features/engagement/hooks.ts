import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { PlanWorkout, PrRecord, Streak } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';
import { getNextPlanWorkout } from '../../lib/planProgress';
import { getCatalogPlan } from '../../lib/trainingCatalog';
import { questScopeId, questStateFor, useQuest } from '../../state/quest';
import { useAuth } from '../../state/auth';
import {
  countFinished,
  questProgress,
  volumeByDay,
  volumeOfSets,
  weekDays,
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

/** One finished session in the current week (powers the Sessions detail sheet). */
export interface SessionSummary {
  id: string;
  name: string;
  date: string;
  volumeKg: number;
  sets: number;
}

/** Volume for a single day of the current week (powers the Volume detail sheet). */
export interface DayVolume {
  date: string;
  volumeKg: number;
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
  /** Finished sessions this week, most recent first. */
  weekSessionList: SessionSummary[];
  /** This week's volume broken down by day (Monday → today). */
  weekVolumeByDay: DayVolume[];
  /** PRs set in the last 30 days (the records behind `prCount`), most recent first. */
  recentPrs: PrRecord[];
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

        // Per-session breakdown for the week — powers the Sessions + Volume
        // sheets from data we already have on hand (getWorkoutsBetween returns
        // finished sessions only, so no extra filtering is needed).
        const weekSetsLists = await Promise.all(
          weekWorkouts.map((w) => repo.getSetsForWorkout(w.id)),
        );
        const weekSessionList: SessionSummary[] = weekWorkouts.map((w, i) => {
          const sets = weekSetsLists[i] ?? [];
          return {
            id: w.id,
            name: w.name,
            date: w.date,
            volumeKg: volumeOfSets(sets),
            sets: sets.length,
          };
        });
        const weekVolumeByDay = volumeByDay(weekSessionList, weekDays(monday, today));
        const recentPrs = prs.filter((p) => p.date >= addDays(today, -30));

        if (!mounted) return;
        setData({
          streak,
          planName: planId ? (getCatalogPlan(planId)?.name ?? null) : null,
          nextWorkout,
          doneToday,
          weekVolumeKg,
          weekSessions: countFinished(weekWorkouts),
          prCount: recentPrs.length,
          kcalEaten: Math.round(kcalByDate[today] ?? 0),
          lastSession,
          weekSessionList,
          weekVolumeByDay,
          recentPrs,
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
  const accountId = useAuth((state) => state.user?.id ?? null);
  const scope = questScopeId(accountId);
  const questStartIso = useQuest((state) => questStateFor(state, accountId).questStartIso);
  const ensureStarted = useQuest((s) => s.ensureStarted);
  const [snapshot, setSnapshot] = useState<{ scope: string; progress: QuestProgress } | null>(null);

  useFocusEffect(
    useCallback(() => {
      // Anchor the window the first time the quest is ever observed.
      if (questStartIso === null) ensureStarted(accountId);
      const startIso = questStartIso ?? questStateFor(useQuest.getState(), accountId).questStartIso;
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
        const currentAccountId = useAuth.getState().user?.id ?? null;
        if (questScopeId(currentAccountId) !== scope) return;
        setSnapshot({ scope, progress: questProgress(finished, startIso, todayIso()) });
      })();
      return () => {
        mounted = false;
      };
    }, [accountId, ensureStarted, questStartIso, scope]),
  );

  return snapshot?.scope === scope ? snapshot.progress : null;
}
