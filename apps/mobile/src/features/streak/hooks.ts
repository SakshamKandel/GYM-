import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { Rank } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';
import {
  getGamificationSnapshot,
  patchWeeklyTarget,
  toGamificationError,
} from '../../lib/api/gamification';
import { getRepo } from '../../lib/repo';
import {
  cancelStreakSaverReminder,
  scheduleStreakSaverReminder,
} from '../../lib/notifications';
import { useAuth } from '../../state/auth';
import { profileSnapshotFor, useGamificationDisplay } from '../../state/gamification';
import { useProfile } from '../../state/profile';
import { daysLeftInWeek, localWeeklyStreak, sessionDayIsosFromWorkouts, STREAK_LOOKBACK_DAYS } from './logic';

/**
 * Everything the weekly-streak UI needs: local-first (offline-capable) streak
 * state computed from SQLite, best-effort enriched with the server snapshot
 * (Rest Shield status, XP/rank, server-cached best streak) when signed in and
 * online. Local computation always wins for `weeks`/`thisWeekDays` display so
 * the number on screen never flickers between an optimistic local read and a
 * slower network one — the server snapshot only ADDS shield/profile info.
 */
export interface WeeklyStreakData {
  weeks: number;
  bestWeeks: number;
  thisWeekDays: number;
  weeklyTarget: number;
  weekStart: string;
  /** Shield info — null until the server snapshot has loaded at least once. */
  shields: { quota: number; usedThisMonth: number; remaining: number } | null;
  /** Personal profile snapshot (XP/level/rank) — null until server-loaded. */
  profile: {
    xpTotal: number;
    level: number;
    xpIntoLevel: number;
    xpForNextLevel: number;
    rank: Rank;
  } | null;
}

export function useWeeklyStreak(): WeeklyStreakData | null {
  const [data, setData] = useState<WeeklyStreakData | null>(null);
  const weeklyTargetDays = useProfile((s) => s.daysPerWeek);
  const token = useAuth((s) => s.token);
  const authStatus = useAuth((s) => s.status);
  const accountId = useAuth((s) => s.user?.id ?? null);
  const setProfileSnapshot = useGamificationDisplay((s) => s.setProfileSnapshot);
  // Guards against a slow server response landing after a newer focus already
  // recomputed local state (stale-write race across re-focuses).
  const requestSeq = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const seq = ++requestSeq.current;

      void (async () => {
        const repo = await getRepo();
        const today = todayIso();
        const from = addDays(today, -STREAK_LOOKBACK_DAYS);
        const workouts = await repo.getWorkoutsBetween(from, today);
        const sessionDayIsos = sessionDayIsosFromWorkouts(workouts);
        const target = Math.max(2, Math.min(7, weeklyTargetDays || 3));
        const local = localWeeklyStreak(sessionDayIsos, target);

        if (!mounted || requestSeq.current !== seq) return;
        // Seed profile/shields from the previous render or the persisted
        // last-known snapshot so the rank emblem never flashes out while the
        // (slow) server snapshot is in flight — it renders instantly with the
        // last confirmed values and the merge below updates them in place.
        const cachedProfile = profileSnapshotFor(useGamificationDisplay.getState(), accountId);
        setData((prev) => ({
          weeks: local.weeks,
          bestWeeks: local.bestWeeks,
          thisWeekDays: local.thisWeekDays,
          weeklyTarget: target,
          weekStart: local.weekStart,
          shields: prev?.shields ?? null,
          profile: prev?.profile ?? cachedProfile,
        }));

        // Streak-saver: schedule only when the week is genuinely short and
        // there's little runway left; cancel once the week is on track. Runs
        // off the freshly-computed local state so it works fully offline.
        const left = daysLeftInWeek(local.weekStart, today);
        const short = local.thisWeekDays < target && left <= 2 && local.weeks > 0;
        if (short) {
          void scheduleStreakSaverReminder(target - local.thisWeekDays, local.weeks);
        } else {
          void cancelStreakSaverReminder();
        }

        // Best-effort server merge (shield status + personal XP/rank). Signed
        // out or offline: local state stands alone, which is still correct
        // for the streak number itself (shield credit just isn't visible yet).
        if (authStatus !== 'signedIn' || !token) return;
        try {
          const snapshot = await getGamificationSnapshot(token);
          if (!mounted || requestSeq.current !== seq) return;
          // Recompute the LOCAL streak with the server's shielded weeks so a
          // week the server auto-consumed a Rest Shield for is reflected in
          // what's on screen — otherwise a shielded week (which the server
          // already counted toward streak.weeks/streak_week XP) would render
          // as a broken streak here, because `local` above was computed with
          // an empty shield list.
          const shielded = localWeeklyStreak(sessionDayIsos, target, snapshot.streak.shieldedWeekStarts);
          const confirmedProfile = {
            xpTotal: snapshot.profile.xpTotal,
            level: snapshot.profile.level,
            xpIntoLevel: snapshot.profile.xpIntoLevel,
            xpForNextLevel: snapshot.profile.xpForNextLevel,
            rank: snapshot.profile.rank,
          };
          // Persist the confirmed snapshot (account-scoped) so the NEXT focus
          // renders the emblem instantly instead of waiting on the network.
          if (accountId) setProfileSnapshot(accountId, confirmedProfile);
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  weeks: Math.max(prev.weeks, shielded.weeks),
                  bestWeeks: Math.max(prev.bestWeeks, snapshot.streak.bestWeeks),
                  shields: snapshot.shields,
                  profile: confirmedProfile,
                }
              : prev,
          );

          // Best-effort reconcile: the server's weeklyTargetDays defaults to
          // 3 and is only ever updated by an explicit Settings PATCH — an
          // account whose onboarding daysPerWeek differs from 3 would have
          // the server judging shield/streak weeks against the wrong target
          // forever otherwise. Push the current local target once whenever
          // it disagrees with what the server has on file.
          if (snapshot.profile.weeklyTargetDays !== target) {
            patchWeeklyTarget(token, target).catch((err) => {
              toGamificationError(err); // swallow — will retry on the next focus
            });
          }
        } catch (err) {
          // A 401 means the cached session may be dead — hand it to the auth
          // store's guarded refresh (health-probe-gated, stale-token safe).
          if (toGamificationError(err).code === 'unauthorized') {
            void useAuth.getState().refresh();
          }
          // Otherwise swallow — offline/network never blocks the streak display.
        }
      })();

      return () => {
        mounted = false;
      };
    }, [weeklyTargetDays, token, authStatus, accountId, setProfileSnapshot]),
  );

  return data;
}
