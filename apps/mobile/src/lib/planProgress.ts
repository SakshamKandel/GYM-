import type { PlanWorkout } from '@gym/shared';
import { ensureTrainingCatalog, getCatalogPlanWorkouts } from './trainingCatalog';
import type { Repo } from './repo';

/**
 * Which workout is next? Simple rotation: find the last completed plan
 * workout and advance one, wrapping at the end. Shared by Home and Train.
 */
export async function getNextPlanWorkout(
  repo: Repo,
  planId: string,
): Promise<PlanWorkout | null> {
  await ensureTrainingCatalog();
  const workouts = getCatalogPlanWorkouts(planId);
  if (workouts.length === 0) return null;
  const recents = await repo.getRecentWorkouts(20);
  const lastPlanWorkoutId = recents.find((w) => w.planWorkoutId !== null)?.planWorkoutId;
  if (!lastPlanWorkoutId) return workouts[0] ?? null;
  const idx = workouts.findIndex((w) => w.id === lastPlanWorkoutId);
  return workouts[(idx + 1) % workouts.length] ?? workouts[0] ?? null;
}
