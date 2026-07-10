import type { WorkoutLog } from '@gym/shared';
import { suggestProgression } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import { getPlanWorkout } from '../../lib/seed/plans';
import { useAuth } from '../../state/auth';
import {
  MAX_SUGGESTIONS_PER_POST,
  postSuggestions,
  type SuggestionPayload,
} from './api';
import {
  HISTORY_DAYS,
  progressionInputFromSets,
  type EngineExercise,
} from './engineInput';

// Server-side per-field caps (see /api/progression/suggestions zod schema).
// Targets are clamped to these client-side so a pathological local row (a
// corrupt/fat-fingered logged weight the engine amplifies past the cap) can
// never 400 the whole batch and starve every valid suggestion in it.
const MAX_TARGET_WEIGHT_KG = 10_000;
const MIN_TARGET_REPS = 1;
const MAX_TARGET_REPS = 100;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/**
 * Post-sync progression hand-off (contracted export — features/sync/
 * workoutSync.ts dynamic-imports this after each server-confirmed batch).
 * Computes the local engine's suggestion for every exercise in the freshly
 * synced workouts and POSTs them for coach review.
 *
 * Best-effort end to end: signed-in only, swallows every error. The logging
 * flow never depends on this — the same engine result renders locally either
 * way. Returns true when every POST landed (or there was nothing to post) so
 * the caller can queue the workout ids for a later retry on failure: the
 * workouts are already marked synced by then, so without the flag a lost POST
 * would never be recomputed. Replays are harmless: the server
 * conflicts-do-nothing on both the row id and the (account, exercise, source
 * workout) unique index.
 */
export async function submitSuggestionsForWorkouts(workoutIds: string[]): Promise<boolean> {
  try {
    const auth = useAuth.getState();
    if (auth.status !== 'signedIn' || !auth.token) return false;
    if (workoutIds.length === 0) return true;
    const repo = await getRepo();

    // Resolve the synced workouts, oldest first, so a backlog drain keys each
    // exercise's suggestion to the LATEST workout that trained it — a target
    // computed from full history but stamped with an older source would lie.
    const workouts = (await Promise.all(workoutIds.map((id) => repo.getWorkout(id))))
      .filter((w): w is WorkoutLog => w !== null)
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
    if (workouts.length === 0) return true;

    // exerciseId → engine meta + source workout; later workouts overwrite earlier.
    const byExercise = new Map<string, { exercise: EngineExercise; sourceWorkoutId: string }>();
    for (const w of workouts) {
      const plan = w.planWorkoutId ? getPlanWorkout(w.planWorkoutId) : undefined;
      const sets = await repo.getSetsForWorkout(w.id);
      for (const s of sets) {
        const repRange =
          plan?.exercises.find((e) => e.exerciseId === s.exerciseId)?.repRange ?? null;
        byExercise.set(s.exerciseId, {
          exercise: { exerciseId: s.exerciseId, exerciseName: s.exerciseName, repRange },
          sourceWorkoutId: w.id,
        });
      }
    }
    if (byExercise.size === 0) return true;

    // One history read serves every exercise in the batch. The synced workouts
    // are finished, so the engine's "last session" IS the source workout.
    const to = todayIso();
    const history = await repo.getSetsBetween(addDays(to, -HISTORY_DAYS), to);

    const payloads: SuggestionPayload[] = [];
    for (const { exercise, sourceWorkoutId } of byExercise.values()) {
      const result = suggestProgression(progressionInputFromSets(history, exercise));
      if (!result) continue;
      payloads.push({
        // Fresh client UUID per attempt — the server's unique index keeps the
        // first row (and its coach review) when a recompute replays.
        id: uid(),
        exerciseId: result.exerciseId,
        exerciseName: result.exerciseName,
        sourceWorkoutId,
        action: result.action,
        targetWeightKg: clamp(result.targetWeightKg, 0, MAX_TARGET_WEIGHT_KG),
        targetRepsMin: clamp(
          Math.round(result.targetRepsMin),
          MIN_TARGET_REPS,
          MAX_TARGET_REPS,
        ),
        targetRepsMax: clamp(
          Math.round(result.targetRepsMax),
          MIN_TARGET_REPS,
          MAX_TARGET_REPS,
        ),
        reason: result.reason,
      });
    }

    for (let i = 0; i < payloads.length; i += MAX_SUGGESTIONS_PER_POST) {
      await postSuggestions(auth.token, payloads.slice(i, i + MAX_SUGGESTIONS_PER_POST));
    }
    return true;
  } catch {
    // Suggestions are a bonus on top of the backup — silent by design; the
    // caller re-queues these workout ids and the next drain retries them.
    return false;
  }
}
