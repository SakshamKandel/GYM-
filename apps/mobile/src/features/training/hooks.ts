import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { hasEntitlement } from '@gym/shared';
import type { PlanWorkout, Tier, WorkoutLog } from '@gym/shared';
import { getPlanVideo } from '../../lib/api/client';
import { getNextPlanWorkout } from '../../lib/planProgress';
import { getRepo } from '../../lib/repo';
import { getGreeceVideo } from '../../lib/seed/greeceVideos';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';

/** Small data hooks — refresh on focus so tabs update after logging. */

export interface TrainData {
  nextWorkout: PlanWorkout | null;
  activeWorkout: WorkoutLog | null;
  loaded: boolean;
}

export function useTrainData(planId: string): TrainData {
  const [data, setData] = useState<TrainData>({
    nextWorkout: null,
    activeWorkout: null,
    loaded: false,
  });

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const [nextWorkout, activeWorkout] = await Promise.all([
          getNextPlanWorkout(repo, planId),
          repo.getActiveWorkout(),
        ]);
        if (mounted) setData({ nextWorkout, activeWorkout, loaded: true });
      })();
      return () => {
        mounted = false;
      };
    }, [planId]),
  );

  return data;
}

export interface ExerciseHistory {
  bestE1Rm: number | null;
  /** Most recent sessions first, max 3: best e1RM per workout date. */
  recentSessions: { date: string; e1rm: number }[];
  loaded: boolean;
}

export function useExerciseHistory(exerciseId: string): ExerciseHistory {
  const [data, setData] = useState<ExerciseHistory>({
    bestE1Rm: null,
    recentSessions: [],
    loaded: false,
  });

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const [bestE1Rm, history] = await Promise.all([
          repo.getBestE1Rm(exerciseId, ''),
          repo.getE1RmHistory(exerciseId, 3),
        ]);
        if (mounted) {
          setData({ bestE1Rm, recentSessions: [...history].reverse(), loaded: true });
        }
      })();
      return () => {
        mounted = false;
      };
    }, [exerciseId]),
  );

  return data;
}

/**
 * Resolved coach-video state for an exercise. The API is the source of truth
 * for a signed, per-tier-gated stream; the bundled `greeceVideos` seed is kept
 * as a graceful fallback for ONE release so playback never hard-breaks before
 * the video host is wired up.
 *
 *  - 'loading'  → still resolving (only the API path is async; seed is sync).
 *  - 'ready'    → play `url` (signed, disposable) with `label`.
 *  - 'locked'   → the caller should render the paywall/upgrade affordance for
 *                 `requiredTier`.
 *  - 'none'     → no video from the API and no seed clip; render nothing/tease.
 */
export type PlanVideoState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; label: string; source: 'api' | 'seed' }
  | { status: 'locked'; requiredTier: Tier }
  | { status: 'none' };

/**
 * Resolve the best available coach video for an exercise.
 *
 * Signed in → asks the gated playback API first. A 200 plays the signed url;
 * a 403 surfaces a locked state (paywall). Any other outcome (no video, keys
 * unconfigured, expired session, offline) falls back to the local seed via
 * getGreeceVideo — so nothing breaks if the host isn't set up yet.
 *
 * Signed out (no token) → skips the API and uses the seed directly.
 *
 * The signed url is short-lived and re-fetched whenever the exercise or the
 * session token changes; it is never cached beyond this hook's state.
 */
export function usePlanVideo(exerciseId: string): PlanVideoState {
  const token = useAuth((s) => s.token);
  const tier = useProfile((s) => s.tier);
  const [state, setState] = useState<PlanVideoState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;

    // Seed fallback (sync): the bundled clip, gated by the SAME entitlement the
    // screen used before the API existed — the demo is a signature_plans (Gold+)
    // perk, so a lower tier still gets the locked teaser, never the raw video.
    const seedState = (): PlanVideoState => {
      const seed = getGreeceVideo(exerciseId);
      if (!seed) return { status: 'none' };
      if (!hasEntitlement({ tier }, 'signature_plans')) {
        return { status: 'locked', requiredTier: 'gold' };
      }
      return { status: 'ready', url: seed.url, label: seed.label ?? "Greece's demo", source: 'seed' };
    };

    if (!exerciseId) {
      setState({ status: 'none' });
      return;
    }

    // Signed out — no session token to gate against, so go straight to seed.
    if (!token) {
      setState(seedState());
      return;
    }

    setState({ status: 'loading' });
    void (async () => {
      const result = await getPlanVideo(exerciseId, token);
      if (!mounted) return;
      switch (result.kind) {
        case 'ok':
          setState({ status: 'ready', url: result.url, label: result.title, source: 'api' });
          break;
        case 'locked':
          setState({ status: 'locked', requiredTier: result.requiredTier });
          break;
        // No ready video, provider unconfigured, or unreachable — degrade to
        // the bundled seed for this release so the demo still plays if hosted.
        case 'not_found':
        case 'not_configured':
        case 'unavailable':
          setState(seedState());
          break;
      }
    })();

    return () => {
      mounted = false;
    };
  }, [exerciseId, token, tier]);

  return state;
}
