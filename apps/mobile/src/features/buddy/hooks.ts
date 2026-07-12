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
import {
  getBuddyLeaderboard,
  getBuddyQuest,
  getChallenge,
  joinChallenge,
  type Challenge,
  type ChallengeJoinErrorCode,
  type LeaderboardRow,
  type QuestPair,
} from '../../lib/api/social';
import { useAuth } from '../../state/auth';
import {
  getBuddyThread,
  getUnread,
  sendBuddyMessage,
  toChatError,
  type BuddyChatMessage,
} from './chatApi';
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
        // getBuddySessions is intentionally NOT caught here (unlike referrals/
        // trial below) — a sessions fetch failure must mark this refresh
        // stale like getBuddies/getBuddyFeed do, not silently render an
        // empty live-session list over a real one. getUnread never throws
        // (it resolves to all-zero on failure), so it needs no .catch here.
        const [nextList, nextEvents, nextSessions, nextReferrals, nextTrial, nextUnread] =
          await Promise.all([
            getBuddies(token),
            getBuddyFeed(token),
            getBuddySessions(token),
            getReferrals(token).catch(() => [] as Referral[]),
            getTrialStatus(token).catch(() => ({ trials: [] as Trial[], trialDays: 2 })),
            getUnread(token),
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
        useBuddyStore.getState().setUnread(nextUnread);
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

// ════════════════════════════════════════════════════════════════
// Social gamification — leaderboard, co-op quest, coach challenge
// ════════════════════════════════════════════════════════════════

const SOCIAL_REFRESH_MS = 30_000;

export interface SocialData {
  leaderboard: LeaderboardRow[];
  leaderboardMonth: string;
  questPairs: QuestPair[];
  questTarget: number;
  challenge: Challenge | null;
  /** True when the latest refresh failed and we're showing the last known state. */
  stale: boolean;
  /** True only for the very first load with nothing fetched yet. */
  loading: boolean;
  reload: () => void;
  /** Opt into the current challenge; caller reloads on success. */
  joinCurrentChallenge: () => Promise<ChallengeJoinErrorCode | null>;
}

/**
 * Leaderboard + buddy quest + coach challenge, refreshed on focus plus a
 * light 30s poll while the Buddy tab is focused and foregrounded (slower
 * than the 12s buddy-list poll — these numbers move once a day, not live).
 * Not persisted (unlike useBuddyData) — these are read-mostly, cheap to
 * refetch, and never need to render before the first successful load.
 */
export function useSocialData(): SocialData {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardMonth, setLeaderboardMonth] = useState('');
  const [questPairs, setQuestPairs] = useState<QuestPair[]>([]);
  const [questTarget, setQuestTarget] = useState(12);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadedOnce = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (status === 'signedOut') {
      loadedOnce.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local state when the account signs out; guarded by the status check.
      setLeaderboard([]);
      setLeaderboardMonth('');
      setQuestPairs([]);
      setChallenge(null);
    }
  }, [status]);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      if (!loadedOnce.current) setLoading(true);
      try {
        const [board, quest, activeChallenge] = await Promise.all([
          getBuddyLeaderboard(token),
          getBuddyQuest(token),
          getChallenge(token).catch(() => null),
        ]);
        const current = useAuth.getState();
        if (current.status !== 'signedIn' || current.token !== token) return;
        if (!mounted.current) return;
        setLeaderboard(board.rows);
        setLeaderboardMonth(board.month);
        setQuestPairs(quest.pairs);
        setQuestTarget(quest.target);
        setChallenge(activeChallenge);
        loadedOnce.current = true;
        setStale(false);
      } catch (err) {
        // Same recovery as useBuddyData above: a 401 hands the session to the
        // auth store's guarded refresh instead of going quietly stale.
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
        if (timer === null) timer = setInterval(reload, SOCIAL_REFRESH_MS);
      };
      const stopTimer = () => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };

      reload();
      startTimer();

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

  const joinCurrentChallenge = useCallback(async (): Promise<ChallengeJoinErrorCode | null> => {
    if (token === null || challenge === null) return 'not_found';
    return joinChallenge(token, challenge.id);
  }, [token, challenge]);

  return {
    leaderboard,
    leaderboardMonth,
    questPairs,
    questTarget,
    challenge,
    stale,
    loading,
    reload,
    joinCurrentChallenge,
  };
}

// ════════════════════════════════════════════════════════════════
// Unread badge refresh — module-level (no hook context needed) so a push
// notification can update the shared store from outside React, same as
// useAuth.getState().refresh() elsewhere in this app.
// ════════════════════════════════════════════════════════════════

/**
 * Re-fetch GET /api/me/unread and write it into the buddy store. Never
 * throws (getUnread already degrades to all-zero on failure) and no-ops
 * when signed out. Called by the Buddy tab's own poll AND by pushRefresh on
 * an incoming 'buddy_message' push, so a badge clears/appears immediately
 * even while the Buddy tab isn't focused.
 */
export async function refreshBuddyUnread(): Promise<void> {
  const { status, token } = useAuth.getState();
  if (status !== 'signedIn' || token === null) return;
  const unread = await getUnread(token);
  // A sign-out mid-fetch must not resurrect unread counts into a cleared store.
  if (useAuth.getState().status !== 'signedIn' || useAuth.getState().token !== token) return;
  useBuddyStore.getState().setUnread(unread);
}

// ════════════════════════════════════════════════════════════════
// One buddy DM thread — mirrors useCoachThread's shape (optimistic send with
// rollback, focus reload, light foreground poll while the thread is open).
// Ephemeral component state (not persisted): a friend DM thread is cheap to
// refetch and, unlike the coach/support threads, has no AI "typing" phase.
// ════════════════════════════════════════════════════════════════

const THREAD_POLL_MS = 12_000;
const OPTIMISTIC_PREFIX = 'local-';

export interface BuddyChatThread {
  /** Oldest → newest, including any still-in-flight optimistic send. */
  messages: BuddyChatMessage[];
  /** First load with nothing cached yet. */
  loading: boolean;
  /** Latest load failed; we're showing the last-known thread. */
  stale: boolean;
  /** A send is in flight. */
  sending: boolean;
  reload: () => void;
  /** Returns true on success; never throws. */
  send: (body: string) => Promise<boolean>;
  /** Last send failure code, or null. Cleared on the next successful send. */
  sendError: 'forbidden' | 'network' | null;
}

function isOptimisticBuddyMsg(m: BuddyChatMessage): boolean {
  return m.id.startsWith(OPTIMISTIC_PREFIX);
}

export function useBuddyChatThread(linkId: string): BuddyChatThread {
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);
  const myId = useAuth((s) => s.user?.id ?? null);

  const [messages, setMessages] = useState<BuddyChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<'forbidden' | 'network' | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadedOnce = useRef(false);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      if (!loadedOnce.current) setLoading(true);
      try {
        const next = await getBuddyThread(token, linkId);
        if (!mounted.current) return;
        // Keep any still-in-flight optimistic bubble ahead of the server set.
        setMessages((prev) => {
          const pending = prev.filter(isOptimisticBuddyMsg);
          return [...next, ...pending];
        });
        loadedOnce.current = true;
        setStale(false);
      } catch (err) {
        if (toChatError(err).code === 'unauthorized') {
          void useAuth.getState().refresh();
        }
        if (mounted.current) setStale(true);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
  }, [linkId, status, token]);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;

      const startTimer = () => {
        if (timer === null) timer = setInterval(reload, THREAD_POLL_MS);
      };
      const stopTimer = () => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };

      reload();
      startTimer();

      // Same AppState guard as useBuddyData: pause polling while backgrounded,
      // refresh immediately and resume on return to foreground.
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

  const send = useCallback(
    async (raw: string): Promise<boolean> => {
      const body = raw.trim();
      if (body.length === 0 || token === null || status !== 'signedIn' || myId === null) {
        return false;
      }

      const now = Date.now();
      const optimistic: BuddyChatMessage = {
        id: `${OPTIMISTIC_PREFIX}${now}`,
        senderAccountId: myId,
        body,
        createdAt: new Date(now).toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setSending(true);
      setSendError(null);

      try {
        const inserted = await sendBuddyMessage(token, linkId, body);
        if (mounted.current) {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== optimistic.id && m.id !== inserted.id),
            inserted,
          ]);
        }
        // A message just landed for me — the shared unread store may be
        // stale for the OTHER side, but mine never had an unread row for my
        // own send, so nothing to clear here beyond the next natural poll.
        return true;
      } catch (err) {
        const code = toChatError(err).code;
        if (mounted.current) {
          setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
          setSendError(code === 'forbidden' ? 'forbidden' : 'network');
          if (code === 'unauthorized') void useAuth.getState().refresh();
        }
        return false;
      } finally {
        if (mounted.current) setSending(false);
      }
    },
    [linkId, status, token, myId],
  );

  return { messages, loading, stale, sending, reload, send, sendError };
}
