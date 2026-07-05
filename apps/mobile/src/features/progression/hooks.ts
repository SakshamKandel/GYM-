import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ProgressionAction, ProgressionResult } from '@gym/shared';
import { suggestProgression } from '@gym/shared';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { getSuggestions, type ServerSuggestion } from './api';
import { buildProgressionInput, type EngineExercise } from './engineInput';

/**
 * The logging flow's view of "what should I lift next?".
 *
 * Local-first: the pure engine computes a suggestion from SQLite history the
 * moment an exercise opens. The server copy (fetched once per workout start)
 * only ever REPLACES it when a coach approved or adjusted it — pending,
 * missing, offline, or signed-out all fall back to the local result silently
 * (contract rule 12: never block the logging flow).
 */

export interface SuggestionView {
  action: ProgressionAction;
  /** Canonical kg — the coach-adjusted weight when the review changed it. */
  weightKg: number;
  repsMin: number;
  repsMax: number;
  reason: string;
  /** True when a coach approved or adjusted this target. */
  reviewed: boolean;
  coachNote: string | null;
}

/**
 * Module-state cache of the server's latest suggestion per exercise. A tiny
 * zustand store (no persist) so rows arriving mid-workout re-render the
 * suggestion row without any wiring in the screen.
 */
const useServerSuggestions = create<{ byExercise: Record<string, ServerSuggestion> }>()(
  () => ({ byExercise: {} }),
);

let fetchInFlight = false;

/**
 * Wipe the cached server suggestions. Called from the auth store on sign-out
 * and the silent 401 sign-out: the rows carry coach-adjusted targets and
 * private coach notes, so a second account on the same device must never see
 * them (an offline sign-in would otherwise render the previous member's
 * "Reviewed by your coach" row).
 */
export function clearServerSuggestions(): void {
  useServerSuggestions.setState({ byExercise: {} });
}

/**
 * Refresh the coach-review state once per workout start. Fire-and-forget:
 * no-ops signed out or mid-flight, swallows every failure — the local engine
 * result renders alone until (and unless) the server copy lands.
 */
export async function refreshServerSuggestions(): Promise<void> {
  if (fetchInFlight) return;
  const auth = useAuth.getState();
  if (auth.status !== 'signedIn' || !auth.token) return;
  fetchInFlight = true;
  try {
    const list = await getSuggestions(auth.token);
    const byExercise: Record<string, ServerSuggestion> = {};
    for (const s of list) byExercise[s.exerciseId] = s;
    useServerSuggestions.setState({ byExercise });
  } catch {
    // Offline / expired session — the local suggestion covers it silently.
  } finally {
    fetchInFlight = false;
  }
}

function serverView(s: ServerSuggestion): SuggestionView {
  return {
    action: s.action,
    weightKg:
      s.status === 'adjusted' && s.adjustedWeightKg !== null
        ? s.adjustedWeightKg
        : s.targetWeightKg,
    repsMin: s.targetRepsMin,
    repsMax: s.targetRepsMax,
    reason: s.reason,
    reviewed: true,
    coachNote: s.coachNote,
  };
}

function localView(r: ProgressionResult): SuggestionView {
  return {
    action: r.action,
    weightKg: r.targetWeightKg,
    repsMin: r.targetRepsMin,
    repsMax: r.targetRepsMax,
    reason: r.reason,
    reviewed: false,
    coachNote: null,
  };
}

/**
 * Suggested next target for one exercise, or null while computing / when
 * there is no usable history. Coach-reviewed server suggestions win;
 * everything else renders the local engine result.
 */
export function useSuggestion(exercise: EngineExercise | null): SuggestionView | null {
  const [local, setLocal] = useState<ProgressionResult | null>(null);
  // Reason strings are unit-formatted — recompute if the display unit flips.
  const unitPref = useProfile((s) => s.unitPref);
  const exerciseId = exercise?.exerciseId ?? null;
  const exerciseName = exercise?.exerciseName ?? '';
  const repRange = exercise?.repRange ?? null;
  const server = useServerSuggestions((s) =>
    exerciseId ? s.byExercise[exerciseId] : undefined,
  );

  useEffect(() => {
    // No exercise → nothing to compute. Stale results from a previous
    // exercise never render — the exercise-switch guard below blocks them.
    if (!exerciseId) return;
    let cancelled = false;
    void (async () => {
      try {
        const input = await buildProgressionInput({ exerciseId, exerciseName, repRange });
        const result = suggestProgression(input);
        if (!cancelled) setLocal(result);
      } catch {
        if (!cancelled) setLocal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // exerciseName always changes with exerciseId — deps stay minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseId, repRange, unitPref]);

  if (!exerciseId) return null;
  if (server && (server.status === 'approved' || server.status === 'adjusted')) {
    return serverView(server);
  }
  // Guard the exercise-switch race: never show the previous exercise's numbers.
  return local && local.exerciseId === exerciseId ? localView(local) : null;
}
