import { trainingBucket, type MuscleGroup } from '../../lib/muscleMap';
import { stockImages, type StockImageKey } from '../ui/stockImages';

/**
 * Deterministic photo selection for a workout, shared by every photographic
 * surface (Home hero's "next" state, the workout-complete strip, …) so the
 * same workout always shows the same, context-appropriate frame.
 *
 * Two signals, name first:
 *  1. The workout NAME — "Leg Day" → legs, "Full Body A" → full-body, "Push" →
 *     press, "Pull/Back" → pull. This is what the athlete reads, so it wins.
 *  2. The muscle FOCUS (first exercise's group) via the shared push/pull/legs
 *     bucket (lib/muscleMap) when the name says nothing specific.
 *
 * Within the chosen bucket a stable string hash of the name picks one of a few
 * dark-toned frames, so two different "pull" days don't show the identical
 * photo — variety without randomness (same input → same output, every launch).
 *
 * Dark-toned photos only (see stockImageTone): white overlay ink stays ≥4.5:1
 * inside the PhotoHero scrim.
 */

type PhotoBucket = 'pull' | 'legs' | 'press' | 'full';

/** Curated dark-toned pools — every key here is `stockImageTone === 'dark'`. */
const POOLS: Record<PhotoBucket, readonly StockImageKey[]> = {
  pull: ['pullupsBw', 'deadliftDark', 'barbellGripOverhead'],
  legs: ['squatWomanBw', 'womanSquatPortraitBw'],
  press: ['overheadPressWoman', 'dumbbellRackGrab'],
  full: ['heroBarbell', 'deadliftDark', 'dumbbellRackGrab', 'gymEmptyBw'],
};

/** djb2 — a tiny, stable, dependency-free string hash. Deterministic forever. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Coarse bucket from words in the workout's name (what the user reads). */
function bucketFromName(name: string): PhotoBucket | null {
  const n = name.toLowerCase();
  if (/\b(full[\s-]?body|total[\s-]?body|whole[\s-]?body)\b/.test(n)) return 'full';
  if (/(leg|squat|quad|hamstring|glute|calf|calve|lower body)/.test(n)) return 'legs';
  if (/(pull|back|row|deadlift|\blat|bicep|curl)/.test(n)) return 'pull';
  if (/(push|press|chest|bench|shoulder|tricep|delt)/.test(n)) return 'press';
  return null;
}

export function photoForWorkoutKey(
  name: string | null | undefined,
  muscle: MuscleGroup | null,
  /**
   * A photo already showing elsewhere on the SAME screen (e.g. the Home
   * hero). When the deterministic pick would collide with it, we deterministically
   * step to the next frame in the same bucket's pool instead — still a pure
   * function of the inputs (no randomness), just collision-avoiding so two
   * surfaces on one screen never show the identical photo.
   */
  avoid?: StockImageKey | null,
): StockImageKey {
  const trimmed = (name ?? '').trim();
  const bucket: PhotoBucket =
    (trimmed !== '' ? bucketFromName(trimmed) : null) ?? trainingBucket(muscle) ?? 'full';
  const pool = POOLS[bucket];
  const index = trimmed !== '' ? hashString(trimmed.toLowerCase()) % pool.length : 0;
  // `index` is always in-range (modulo pool.length) and pools are never empty.
  const picked = pool[index] ?? pool[0]!;
  if (avoid != null && picked === avoid && pool.length > 1) {
    return pool[(index + 1) % pool.length] ?? picked;
  }
  return picked;
}

export function photoForWorkout(
  name: string | null | undefined,
  muscle: MuscleGroup | null,
  avoid?: StockImageKey | null,
) {
  return stockImages[photoForWorkoutKey(name, muscle, avoid)];
}
