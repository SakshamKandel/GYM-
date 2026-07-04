import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getBuddies,
  getBuddyFeed,
  getBuddySessions,
  getReferrals,
  getTrialStatus,
  toBuddyError,
  type BuddyEvent,
  type BuddyList,
  type BuddySession,
  type Referral,
  type Trial,
} from '../../lib/api/client';
import { useAuth } from '../../state/auth';
import { useBuddyStore } from './store';

/**
 * Everything the Buddy tab needs. Refreshes on focus plus a lightweight
 * 12s interval while the tab stays focused AND the app is foregrounded.
 * Returning from background triggers an immediate reload (the interval is
 * paused while backgrounded to save battery, resumed on 'active'). Failures
 * keep the cached snapshot and flip `stale` so the screen shows a quiet retry
 * row — never a blocking error screen.
 */

const REFRESH_MS = 12_000;

export interface BuddyData {
  list: BuddyList | null;
  events: BuddyEvent[];
  sessions: BuddySession[];
  referrals: Referral[];
  trials: Trial[];
  trialDays: number;
  /** True when the latest refresh failed and we're showing the last known state. */
  stale: boolean;
  /** True only for the very first load with nothing cached yet. */
  loading: boolean;
  reload: () => void;
}

export function useBuddyData(): BuddyData {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const list = useBuddyStore((s) => s.list);
  const events = useBuddyStore((s) => s.events);
  const sessions = useBuddyStore((s) => s.sessions);
  const referrals = useBuddyStore((s) => s.referrals);
  const trials = useBuddyStore((s) => s.trials);
  const trialDays = useBuddyStore((s) => s.trialDays);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A fresh account must never see the previous account's buddies.
  useEffect(() => {
    if (status === 'signedOut' && useBuddyStore.getState().list !== null) {
      useBuddyStore.getState().clear();
    }
  }, [status]);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      if (useBuddyStore.getState().list === null) setLoading(true);
      try {
        const [nextList, nextEvents, nextSessions, nextReferrals, nextTrial] = await Promise.all([
          getBuddies(token),
          getBuddyFeed(token),
          getBuddySessions(token).catch(() => [] as BuddySession[]),
          getReferrals(token).catch(() => [] as Referral[]),
          getTrialStatus(token).catch(() => ({ trials: [] as Trial[], trialDays: 2 })),
        ]);
        // The session changed while the fetch was in flight (sign-out or
        // account switch) — a late response must not write the previous
        // account's buddies back into the persisted cache.
        const current = useAuth.getState();
        if (current.status !== 'signedIn' || current.token !== token) return;
        useBuddyStore.getState().setData(nextList, nextEvents);
        useBuddyStore.getState().setSessions(nextSessions);
        useBuddyStore.getState().setReferrals(nextReferrals);
        useBuddyStore.getState().setTrials(nextTrial.trials, nextTrial.trialDays);
        if (mounted.current) setStale(false);
      } catch (err) {
        if (toBuddyError(err).code === 'unauthorized') {
          void useAuth.getState().refresh();
        }
        if (mounted.current) setStale(true);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;

      const startTimer = () => {
        if (timer === null) timer = setInterval(reload, REFRESH_MS);
      };
      const stopTimer = () => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };

      // Immediate refresh on focus, then poll while foregrounded.
      reload();
      startTimer();

      // useFocusEffect fires on NAVIGATION focus only — it does NOT re-run
      // when the app returns from OS background while this tab is already
      // focused. Without this listener the screen shows stale data until the
      // user navigates away and back (or relaunches). On resume we reload
      // immediately and resume polling; while backgrounded we pause the timer.
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          reload();
          startTimer();
        } else {
          stopTimer();
        }
      });

      return () => {
        stopTimer();
        sub.remove();
      };
    }, [reload]),
  );

  return { list, events, sessions, referrals, trials, trialDays, stale, loading, reload };
}
