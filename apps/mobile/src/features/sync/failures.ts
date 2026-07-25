import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getRepoForAccount } from '../../lib/repo';
import type { WorkoutSyncFailure } from '../../lib/repo/types';
import { useAuth } from '../../state/auth';
import { syncWorkouts } from './workoutSync';

/**
 * Quarantined-workout recovery.
 *
 * A workout the server rejects with 400 is marked failed and dropped from the
 * pending queue so it cannot wedge the rows behind it (see workoutSync.ts).
 * Without a way back out, that row would stay unbacked-up forever and nobody
 * would ever know — a silent hole in the backup. This module is the way back
 * out: it reads the quarantine list and can lift it, which re-admits the row to
 * `getUnsyncedFinishedWorkouts` and lets the ordinary drain try again.
 *
 * Everything here is advisory. The workout is already safe in local storage,
 * so a failed retry changes nothing except the timestamp on the mark.
 */

/** Plenty for a Settings summary; the rows stay local regardless. */
const MAX_FAILURES = 20;

/**
 * Lift the quarantine on some workouts and kick a sync. Clearing first means
 * the drain picks them up naturally — no second upload path to keep in step
 * with the real one. Resolves when the drain finishes; never throws.
 */
export async function retryFailedWorkouts(workoutIds: readonly string[]): Promise<void> {
  if (workoutIds.length === 0) return;
  const auth = useAuth.getState();
  // Quarantine marks only ever exist inside an account's namespace, so there
  // is nothing to retry (and no token to retry with) while signed out.
  if (auth.status !== 'signedIn' || !auth.user) return;
  const accountId = auth.user.id;
  try {
    const repo = await getRepoForAccount(accountId);
    for (const workoutId of workoutIds) {
      await repo.clearWorkoutSyncFailure(workoutId);
    }
  } catch {
    // Local write failed — the marks stay, the next attempt repeats this.
    return;
  }
  await syncWorkouts();
}

/** Single-row form of {@link retryFailedWorkouts}. */
export async function retryFailedWorkout(workoutId: string): Promise<void> {
  await retryFailedWorkouts([workoutId]);
}

export interface WorkoutSyncFailuresState {
  /** Workouts the server refused. Empty while signed out or all clear. */
  failures: WorkoutSyncFailure[];
  /** True while a retry runs — surfaces as a quiet inline spinner, never a block. */
  retrying: boolean;
  /** Retry every listed workout. Fire-and-forget; safe to tap twice. */
  retry: () => void;
}

/**
 * Read the quarantine list for the signed-in account, refreshed on focus.
 * Failures are rare, so the common result is an empty array and the caller
 * renders nothing at all.
 */
export function useWorkoutSyncFailures(): WorkoutSyncFailuresState {
  const accountId = useAuth((s) => (s.status === 'signedIn' ? (s.user?.id ?? null) : null));
  const [failures, setFailures] = useState<WorkoutSyncFailure[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Async loads resolve after a sign-out or a screen pop; the flag keeps their
  // results from landing on a component that no longer wants them.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      if (accountId === null) {
        // Signed out: keep the identity of an already-empty list so focusing
        // Settings doesn't re-render for nothing.
        setFailures((prev) => (prev.length === 0 ? prev : []));
      } else {
        void (async () => {
          try {
            const repo = await getRepoForAccount(accountId);
            const rows = await repo.getWorkoutSyncFailures(MAX_FAILURES);
            if (current && alive.current) setFailures(rows);
          } catch {
            // Diagnostics only — a failed read must never disturb the screen.
          }
        })();
      }
      return () => {
        current = false;
      };
    }, [accountId, reloadKey]),
  );

  const retry = useCallback(() => {
    if (accountId === null || retrying || failures.length === 0) return;
    const ids = failures.map((f) => f.workoutId);
    setRetrying(true);
    void (async () => {
      await retryFailedWorkouts(ids);
      if (!alive.current) return;
      setRetrying(false);
      // Re-read rather than assume: workouts the server still refuses come
      // back marked, and the row keeps showing an honest count.
      setReloadKey((n) => n + 1);
    })();
  }, [accountId, failures, retrying]);

  return { failures, retrying, retry };
}
