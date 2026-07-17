import { type MuscleGroup } from '../../lib/muscleMap';
import { stockImages, type StockImageKey } from '../ui/stockImages';
import { photoForWorkoutKey } from './workoutPhoto';

/**
 * Picks the Home-tab hero photo, keyed on the screen's three states rather than
 * only muscle focus:
 *  - `done`   — a cinematic, reflective frame for "you showed up today".
 *  - `noPlan` — a calm, inviting empty gym: come set a plan.
 *  - `next`   — the frame that matches the ACTUAL upcoming workout (name first,
 *               then muscle focus) via the shared `photoForWorkout` helper, so
 *               "Full Body A" gets a full-body shot and "Leg Day" a legs shot.
 *
 * The done/noPlan states use their own distinct frames so no two Home states
 * collide. Dark-toned photos only (see stockImageTone) so white overlay text
 * stays ≥4.5:1 inside the scrim. Pure mapping — same inputs, same photo.
 */

export type HomeHeroState = 'done' | 'noPlan' | 'next';

export function homeHeroImageKey(
  state: HomeHeroState,
  muscle: MuscleGroup | null,
  workoutName?: string | null,
): StockImageKey {
  if (state === 'done') return 'womanSquatPortraitBw';
  if (state === 'noPlan') return 'gymEmptyBw';
  return photoForWorkoutKey(workoutName ?? null, muscle);
}

export function homeHeroImage(
  state: HomeHeroState,
  muscle: MuscleGroup | null,
  workoutName?: string | null,
) {
  return stockImages[homeHeroImageKey(state, muscle, workoutName)];
}
