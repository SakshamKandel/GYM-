import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { detectPlateau, hasEntitlement } from '@gym/shared';
import type { Exercise, PlanWorkout, PlateauVerdict, Tier, WorkoutLog } from '@gym/shared';
import { getPlanVideo } from '../../lib/api/client';
import { addDays, todayIso } from '../../lib/dates';
import { getExercise } from '../../lib/exercises';
import { getNextPlanWorkout } from '../../lib/planProgress';
import { getRepo } from '../../lib/repo';
import type { AnalyticsSet } from '../../lib/repo/types';
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

/** Wide-open lower bound — the detail screen wants all-time records. */
const ALL_TIME_FROM = '2000-01-01';
/** Points on the detail e1RM trend chart. */
const E1RM_CHART_POINTS = 20;

export interface ExerciseSession {
  /** yyyy-mm-dd of the finished workout day. */
  date: string;
  /** Heaviest set that day (ties broken by more reps). */
  topWeightKg: number;
  topReps: number;
  /** Total weight × reps for this exercise that day. */
  volumeKg: number;
}

export interface ExerciseHistory {
  /** Best e1RM per workout day, oldest first — chart-ready. */
  e1rmHistory: { date: string; e1rm: number }[];
  /** Trend verdict over the charted e1RM points. */
  plateau: PlateauVerdict;
  bestE1RmKg: number | null;
  bestWeightKg: number | null;
  /** Highest single-day volume for this exercise. */
  bestSessionVolumeKg: number | null;
  /** Most recent training days first, max 3. */
  recentSessions: ExerciseSession[];
  loaded: boolean;
}

const EMPTY_HISTORY: ExerciseHistory = {
  e1rmHistory: [],
  plateau: 'insufficient',
  bestE1RmKg: null,
  bestWeightKg: null,
  bestSessionVolumeKg: null,
  recentSessions: [],
  loaded: false,
};

/** Fold one exercise's sets into per-day session summaries, oldest first. */
function toSessions(sets: AnalyticsSet[]): ExerciseSession[] {
  const byDate = new Map<string, ExerciseSession>();
  for (const s of sets) {
    const cur = byDate.get(s.workoutDate);
    if (!cur) {
      byDate.set(s.workoutDate, {
        date: s.workoutDate,
        topWeightKg: s.weightKg,
        topReps: s.reps,
        volumeKg: s.weightKg * s.reps,
      });
      continue;
    }
    cur.volumeKg += s.weightKg * s.reps;
    if (
      s.weightKg > cur.topWeightKg ||
      (s.weightKg === cur.topWeightKg && s.reps > cur.topReps)
    ) {
      cur.topWeightKg = s.weightKg;
      cur.topReps = s.reps;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function useExerciseHistory(exerciseId: string): ExerciseHistory {
  const [data, setData] = useState<ExerciseHistory>(EMPTY_HISTORY);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const [bestE1RmKg, bestWeightKg, e1rmHistory, allSets] = await Promise.all([
          repo.getBestE1Rm(exerciseId, ''),
          repo.getBestWeight(exerciseId, ''),
          repo.getE1RmHistory(exerciseId, E1RM_CHART_POINTS),
          repo.getSetsBetween(ALL_TIME_FROM, todayIso()),
        ]);
        if (!mounted) return;
        const sessions = toSessions(allSets.filter((s) => s.exerciseId === exerciseId));
        setData({
          e1rmHistory,
          plateau: detectPlateau(e1rmHistory.map((h) => ({ date: h.date, value: h.e1rm }))),
          bestE1RmKg,
          bestWeightKg,
          bestSessionVolumeKg:
            sessions.length > 0 ? Math.max(...sessions.map((s) => s.volumeKg)) : null,
          recentSessions: sessions.slice(-3).reverse(),
          loaded: true,
        });
      })();
      return () => {
        mounted = false;
      };
    }, [exerciseId]),
  );

  return data;
}

export interface RecentExercise {
  exercise: Exercise;
  /** Whole days since the last finished session, when recent enough to know cheaply. */
  daysAgo: number | null;
}

/** How far back one query looks to caption recent tiles with "x d ago". */
const RECENT_CAPTION_WINDOW_DAYS = 120;

function daysBefore(iso: string, todayStr: string): number {
  const ms =
    new Date(`${todayStr}T12:00:00`).getTime() - new Date(`${iso}T12:00:00`).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

/** Last-used exercises for the library's Recent strip, most recent first. */
export function useRecentExercises(limit: number): RecentExercise[] {
  const [items, setItems] = useState<RecentExercise[]>([]);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const repo = await getRepo();
        const today = todayIso();
        const [ids, windowSets] = await Promise.all([
          repo.getRecentExerciseIds(limit),
          repo.getSetsBetween(addDays(today, -RECENT_CAPTION_WINDOW_DAYS), today),
        ]);
        if (!mounted) return;
        // Sets arrive oldest → newest, so the map ends on each exercise's last date.
        const lastDate = new Map<string, string>();
        for (const s of windowSets) lastDate.set(s.exerciseId, s.workoutDate);
        setItems(
          ids.flatMap((id) => {
            const exercise = getExercise(id);
            if (!exercise) return [];
            const last = lastDate.get(id);
            return [{ exercise, daysAgo: last ? daysBefore(last, today) : null }];
          }),
        );
      })();
      return () => {
        mounted = false;
      };
    }, [limit]),
  );

  return items;
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
