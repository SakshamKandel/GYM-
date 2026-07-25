import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { isCurrentSessionRequest } from '../../lib/sessionRequest';
import { useAuth } from '../../state/auth';
import {
  getCoachDirectory,
  getMyCoach,
  getMyCoachApplication,
  getMyMilestones,
  type AssignedCoach,
  type CoachApplication,
  type CoachCardData,
  type CoachMilestone,
  type PendingCoachRequest,
} from './api';

/**
 * Member mentorship hooks. All three load on focus while signed in and keep
 * the last-known state through transient failures. Every snapshot is keyed
 * by the session token it was fetched with and DERIVED against the current
 * token at render — so a response racing a sign-out is dropped, and a fresh
 * account can never see the previous account's coach data (no reset effects
 * needed; the pattern app/leaderboard.tsx uses, taken one step further).
 *
 * The token check alone isn't enough for the SAME session, though: a coach
 * push arriving while a focus load is still in flight starts a second one, and
 * whichever answers last wins. So each hook also carries the monotonic request
 * sequence from lib/sessionRequest (the rule lib/useSessionScopedResource
 * follows) — an older answer for the same session is dropped instead of
 * overwriting the newer one, on success and on failure alike.
 */

/**
 * What an in-flight request is compared against before it may touch state:
 * the session that is live RIGHT NOW plus the newest request this hook made.
 */
function liveSession(sequence: number): { token: string | null; sequence: number } {
  return { token: useAuth.getState().token, sequence };
}

// ── Coach directory ───────────────────────────────────────────

export interface CoachDirectoryState {
  /** null until the first successful load of THIS session. */
  coaches: CoachCardData[] | null;
  /** True only while signed in with nothing loaded and no error yet. */
  loading: boolean;
  /** The latest load failed — offer a retry. */
  error: boolean;
  retry: () => void;
}

export function useCoachDirectory(): CoachDirectoryState {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [snap, setSnap] = useState<{ token: string; coaches: CoachCardData[] } | null>(null);
  const [errorToken, setErrorToken] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    const request = { token, sequence: ++requestSequence.current };
    void (async () => {
      try {
        const next = await getCoachDirectory(token);
        if (!isCurrentSessionRequest(request, liveSession(requestSequence.current))) return;
        setSnap({ token, coaches: next });
        setErrorToken(null);
      } catch {
        if (!isCurrentSessionRequest(request, liveSession(requestSequence.current))) return;
        setErrorToken(token);
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const retry = useCallback(() => {
    setErrorToken(null);
    reload();
  }, [reload]);

  // Derive against the CURRENT session — stale snapshots read as "no data".
  const coaches = snap !== null && snap.token === token ? snap.coaches : null;
  const error = errorToken !== null && errorToken === token;

  return {
    coaches,
    loading: status === 'signedIn' && coaches === null && !error,
    error,
    retry,
  };
}

// ── My coach / pending request ────────────────────────────────

/**
 * Every currently-mounted `useMyCoach()` instance's `reload`, so a
 * `coach_unassigned` push arriving while Coach Chat (or anywhere else that
 * renders `useMyCoach`) is already open can force an immediate re-fetch
 * instead of waiting for the next focus event. `useMyCoach` has no zustand
 * store of its own (unlike the checkin/gamification/suggestion caches this
 * file's siblings piggyback on), so this tiny listener set is the minimal
 * bridge — features/realtime/pushRefresh.ts calls `triggerMyCoachRefresh()`
 * on the 'coach' push event; it never throws and no-ops when nothing is
 * mounted.
 */
const myCoachReloadListeners = new Set<() => void>();

/** Best-effort: re-run every mounted `useMyCoach()`'s reload. Never throws. */
export function triggerMyCoachRefresh(): void {
  for (const listener of myCoachReloadListeners) {
    try {
      listener();
    } catch {
      // A listener's own reload already swallows its errors — this guard is
      // just so one bad subscriber can't stop the rest from refreshing.
    }
  }
}

export interface MyCoachData {
  /** The assigned coach, or null (none / signed out / not loaded yet). */
  coach: AssignedCoach | null;
  /** The one pending request, or null. */
  request: PendingCoachRequest | null;
  /** True once a fetch for THIS session has resolved successfully. */
  loaded: boolean;
  reload: () => void;
}

export function useMyCoach(): MyCoachData {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [snap, setSnap] = useState<{
    token: string;
    coach: AssignedCoach | null;
    request: PendingCoachRequest | null;
  } | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    // A 'coach' push calls triggerMyCoachRefresh while the focus load may
    // still be in flight, so the sequence decides which answer counts.
    const request = { token, sequence: ++requestSequence.current };
    void (async () => {
      try {
        const next = await getMyCoach(token);
        if (!isCurrentSessionRequest(request, liveSession(requestSequence.current))) return;
        setSnap({ token, coach: next.coach, request: next.request });
      } catch {
        // Keep the last-known state — surfaces stay quiet through blips.
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Subscribe this instance's reload to the push-triggered refresh channel
  // for as long as it's mounted (see `triggerMyCoachRefresh` above).
  useEffect(() => {
    myCoachReloadListeners.add(reload);
    return () => {
      myCoachReloadListeners.delete(reload);
    };
  }, [reload]);

  const valid = snap !== null && snap.token === token;
  return {
    coach: valid ? snap.coach : null,
    request: valid ? snap.request : null,
    loaded: valid,
    reload,
  };
}

// ── My coach application ───────────────────────────────────────

export interface MyCoachApplicationData {
  /** null = not loaded yet OR never applied — `loaded` disambiguates. */
  application: CoachApplication | null;
  /** True once a fetch for THIS session has resolved successfully. */
  loaded: boolean;
  /** The latest load failed — offer a retry (the FIRST load has no other way
   * to leave the screen stuck on an indefinite spinner). */
  error: boolean;
  reload: () => void;
  /**
   * Optimistically sets the local snapshot right after a successful submit,
   * without waiting on a follow-up GET. A submit's own 201 is the source of
   * truth for "it worked" — a flaky refetch right after must never regress
   * the screen back to a stale (e.g. still-rejected) snapshot or leave a
   * first-time submitter looking at their own untouched form with no
   * confirmation.
   */
  setApplication: (application: CoachApplication) => void;
}

export function useMyCoachApplication(): MyCoachApplicationData {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [snap, setSnap] = useState<{
    token: string;
    application: CoachApplication | null;
  } | null>(null);
  const [errorToken, setErrorToken] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    const request = { token, sequence: ++requestSequence.current };
    void (async () => {
      try {
        const next = await getMyCoachApplication(token);
        if (!isCurrentSessionRequest(request, liveSession(requestSequence.current))) return;
        setSnap({ token, application: next });
        setErrorToken(null);
      } catch {
        if (!isCurrentSessionRequest(request, liveSession(requestSequence.current))) return;
        setErrorToken(token);
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const setApplication = useCallback(
    (application: CoachApplication) => {
      if (token === null) return;
      // The submit's own response is the newest truth there is, so it also
      // retires any refetch still in flight — that older answer landing on top
      // is exactly the regression this setter exists to prevent.
      requestSequence.current += 1;
      setSnap({ token, application });
      setErrorToken(null);
    },
    [token],
  );

  const valid = snap !== null && snap.token === token;
  return {
    application: valid ? snap.application : null,
    loaded: valid,
    error: errorToken !== null && errorToken === token,
    reload,
    setApplication,
  };
}

// ── My milestones ─────────────────────────────────────────────

export interface MyMilestonesData {
  milestones: CoachMilestone[];
  /** True once a fetch for THIS session has resolved successfully. */
  loaded: boolean;
  reload: () => void;
}

export function useMyMilestones(): MyMilestonesData {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [snap, setSnap] = useState<{ token: string; milestones: CoachMilestone[] } | null>(
    null,
  );
  const requestSequence = useRef(0);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    const request = { token, sequence: ++requestSequence.current };
    void (async () => {
      try {
        const next = await getMyMilestones(token);
        if (!isCurrentSessionRequest(request, liveSession(requestSequence.current))) return;
        setSnap({ token, milestones: next });
      } catch {
        // Keep the last-known list — the section simply stays as it was.
      }
    })();
  }, [status, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const valid = snap !== null && snap.token === token;
  return {
    milestones: valid ? snap.milestones : [],
    loaded: valid,
    reload,
  };
}
