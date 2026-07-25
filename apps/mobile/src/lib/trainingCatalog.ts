import { useEffect } from 'react';
import { create } from 'zustand';
import type { Exercise, PlanWorkout, TrainingCatalog, TrainingCatalogPlan } from '@gym/shared';
import { getTrainingCatalog, toApiError } from './api/client';
import { getRepoForAccount } from './repo';
import { useAuth } from '../state/auth';

/**
 * Programs and exercises live in Neon and reach the app through ONE read:
 * GET /api/me/training-catalog, which answers 401 without a bearer token. So
 * with no account there is no catalog at all — no programs, no exercise
 * library, nothing for the muscle map or the workout picker to show.
 *
 * That is why setup now ends by creating the account
 * (features/onboarding/OnboardingWizard.tsx) and why every surface that reads
 * this store must treat 'authRequired' as "ask for the account", never as an
 * error and never as an empty library. If the endpoint ever serves an
 * unauthenticated read, this module is where that lands: fetch without a
 * token, keep tier-gated plan bodies hidden, and 'authRequired' disappears.
 */
export type TrainingCatalogStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'cached'
  /** Signed out: the catalog cannot be read at all (see the note above). */
  | 'authRequired'
  | 'error';

interface TrainingCatalogState {
  accountId: string | null;
  catalog: TrainingCatalog | null;
  status: TrainingCatalogStatus;
  refreshing: boolean;
  fetchedAt: string | null;
  error: 'network' | 'unauthorized' | null;
}

const INITIAL_STATE: TrainingCatalogState = {
  accountId: null,
  catalog: null,
  status: 'idle',
  refreshing: false,
  fetchedAt: null,
  error: null,
};

const useTrainingCatalogState = create<TrainingCatalogState>()(() => INITIAL_STATE);

let requestSequence = 0;
let inFlight: { key: string; promise: Promise<TrainingCatalog | null> } | null = null;

function authSnapshot(): { accountId: string; token: string } | null {
  const auth = useAuth.getState();
  if (auth.status !== 'signedIn' || !auth.token || !auth.user?.id) return null;
  return { accountId: auth.user.id, token: auth.token };
}

function isCurrent(accountId: string, token: string, sequence: number): boolean {
  const auth = authSnapshot();
  return sequence === requestSequence && auth?.accountId === accountId && auth.token === token;
}

function clearForSignedOut(): void {
  requestSequence += 1;
  inFlight = null;
  useTrainingCatalogState.setState({ ...INITIAL_STATE, status: 'authRequired' });
}

/**
 * One catalog read.
 *
 * When we already hold a snapshot we ask the server about ITS revision, so an
 * unchanged library costs a small confirmation instead of re-downloading an
 * exercise library the device already has byte for byte. The server recomputes
 * the revision from the live tables on every read, so a real edit still lands
 * on the very next refresh.
 *
 * An 'unchanged' answer is only ever accepted against the snapshot whose
 * revision we sent (the repo already refuses to hand back a cache that doesn't
 * validate, so a corrupt or partial one arrives here as `null`). With nothing
 * to stand on we ask for the whole thing rather than trust a partial answer.
 */
async function readTrainingCatalog(
  token: string,
  held: TrainingCatalog | null,
): Promise<TrainingCatalog> {
  const result = await getTrainingCatalog(token, held?.revision ?? null);
  if (result.kind === 'catalog') return result.catalog;
  if (held) return held;
  const full = await getTrainingCatalog(token);
  if (full.kind === 'catalog') return full.catalog;
  throw new Error('training catalog unavailable');
}

/** Hydrate a validated account cache, then refresh it from Neon. */
export async function loadTrainingCatalog(force = false): Promise<TrainingCatalog | null> {
  const auth = authSnapshot();
  if (!auth) {
    clearForSignedOut();
    return null;
  }

  const key = `${auth.accountId}:${auth.token}`;
  if (inFlight?.key === key) return inFlight.promise;
  const current = useTrainingCatalogState.getState();
  if (!force && current.accountId === auth.accountId && current.status === 'ready') {
    return current.catalog;
  }

  const sequence = ++requestSequence;
  const promise = (async (): Promise<TrainingCatalog | null> => {
    const sameAccountCatalog = current.accountId === auth.accountId ? current.catalog : null;
    useTrainingCatalogState.setState({
      accountId: auth.accountId,
      catalog: sameAccountCatalog,
      status: sameAccountCatalog ? current.status : 'loading',
      refreshing: true,
      fetchedAt: sameAccountCatalog ? current.fetchedAt : null,
      error: null,
    });

    const repo = await getRepoForAccount(auth.accountId);
    const cached = await repo.getTrainingCatalogCache();
    if (!isCurrent(auth.accountId, auth.token, sequence)) return null;
    if (cached && !sameAccountCatalog) {
      useTrainingCatalogState.setState({
        accountId: auth.accountId,
        catalog: cached.catalog,
        status: 'cached',
        refreshing: true,
        fetchedAt: cached.fetchedAt,
        error: null,
      });
    }

    try {
      // What the app is already showing: memory first, then the validated disk
      // cache. Its revision is what makes the read below conditional.
      const held = sameAccountCatalog ?? cached?.catalog ?? null;
      const catalog = await readTrainingCatalog(auth.token, held);
      if (!isCurrent(auth.accountId, auth.token, sequence)) return null;
      const fetchedAt = new Date().toISOString();
      await repo.saveTrainingCatalogCache({ catalog, fetchedAt });
      if (!isCurrent(auth.accountId, auth.token, sequence)) return null;
      useTrainingCatalogState.setState({
        accountId: auth.accountId,
        catalog,
        status: 'ready',
        refreshing: false,
        fetchedAt,
        error: null,
      });
      return catalog;
    } catch (error: unknown) {
      if (!isCurrent(auth.accountId, auth.token, sequence)) return null;
      const code = toApiError(error).code === 'unauthorized' ? 'unauthorized' : 'network';
      const fallback = useTrainingCatalogState.getState().catalog ?? cached?.catalog ?? null;
      useTrainingCatalogState.setState({
        accountId: auth.accountId,
        catalog: fallback,
        status: fallback ? 'cached' : 'error',
        refreshing: false,
        fetchedAt: useTrainingCatalogState.getState().fetchedAt ?? cached?.fetchedAt ?? null,
        error: code,
      });
      if (code === 'unauthorized') void useAuth.getState().refresh();
      return fallback;
    }
  })();

  inFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

export async function ensureTrainingCatalog(): Promise<TrainingCatalog | null> {
  const auth = authSnapshot();
  const state = useTrainingCatalogState.getState();
  if (auth && state.accountId === auth.accountId && state.catalog) return state.catalog;
  return loadTrainingCatalog(false);
}

export function useTrainingCatalog(): TrainingCatalogState & {
  refresh: () => Promise<TrainingCatalog | null>;
} {
  const state = useTrainingCatalogState();
  const authStatus = useAuth((auth) => auth.status);
  const token = useAuth((auth) => auth.token);
  const accountId = useAuth((auth) => auth.user?.id ?? null);

  useEffect(() => {
    if (authStatus === 'signedIn' && token && accountId) void loadTrainingCatalog(false);
    else if (authStatus === 'signedOut') clearForSignedOut();
  }, [accountId, authStatus, token]);

  return { ...state, refresh: () => loadTrainingCatalog(true) };
}

export function allCatalogPlans(): TrainingCatalogPlan[] {
  return useTrainingCatalogState.getState().catalog?.plans ?? [];
}

export function getCatalogPlan(id: string): TrainingCatalogPlan | undefined {
  return allCatalogPlans().find((plan) => plan.id === id);
}

export function getCatalogPlanWorkouts(planId: string): PlanWorkout[] {
  return getCatalogPlan(planId)?.workouts ?? [];
}

export function getCatalogPlanWorkout(planWorkoutId: string): PlanWorkout | undefined {
  for (const plan of allCatalogPlans()) {
    const workout = plan.workouts.find((item) => item.id === planWorkoutId);
    if (workout) return workout;
  }
  return undefined;
}

export function allCatalogExercises(): Exercise[] {
  return useTrainingCatalogState.getState().catalog?.exercises ?? [];
}

export function getCatalogExercise(id: string): Exercise | undefined {
  return allCatalogExercises().find((exercise) => exercise.id === id);
}

export function isExerciseInCatalogPlan(exerciseId: string): boolean {
  return allCatalogPlans().some((plan) =>
    plan.workouts.some((workout) =>
      workout.exercises.some((exercise) => exercise.exerciseId === exerciseId),
    ),
  );
}

export interface ExerciseFilter {
  query?: string;
  muscleGroup?: string;
  equipment?: string;
}

export function searchCatalogExercises(filter: ExerciseFilter): Exercise[] {
  const query = filter.query?.trim().toLowerCase();
  return allCatalogExercises().filter((exercise) => {
    if (filter.muscleGroup && exercise.muscleGroup !== filter.muscleGroup) return false;
    if (filter.equipment && exercise.equipment !== filter.equipment) return false;
    if (query && !exercise.name.toLowerCase().includes(query)) return false;
    return true;
  });
}
