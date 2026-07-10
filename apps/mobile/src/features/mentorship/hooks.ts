import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../state/auth';
import {
  getCoachDirectory,
  getMyCoach,
  getMyMilestones,
  type AssignedCoach,
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
 */

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

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      try {
        const next = await getCoachDirectory(token);
        if (useAuth.getState().token !== token) return;
        setSnap({ token, coaches: next });
        setErrorToken(null);
      } catch {
        if (useAuth.getState().token !== token) return;
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

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      try {
        const next = await getMyCoach(token);
        if (useAuth.getState().token !== token) return;
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

  const valid = snap !== null && snap.token === token;
  return {
    coach: valid ? snap.coach : null,
    request: valid ? snap.request : null,
    loaded: valid,
    reload,
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

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null) return;
    void (async () => {
      try {
        const next = await getMyMilestones(token);
        if (useAuth.getState().token !== token) return;
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
