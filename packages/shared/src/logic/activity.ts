import { bmr } from './macros';

/**
 * Activity & energy-expenditure estimates — pure, unit-tested (CLAUDE.md rule 10).
 *
 * Every formula in this file is a HEURISTIC: good enough to tell a motivating
 * "calories in vs out" story on the dashboard, not a medical measurement.
 * Steps arrive from phone/watch sensors, so all inputs are sanitized —
 * negative, NaN or infinite values are treated as 0 (missing data).
 */

// stepsGoal lives in macros.ts (computeTargets needs it and macros.ts must
// stay free of runtime imports); re-exported here per the activity contract.
export { stepsGoal } from './macros';

/** Negative/NaN/Infinity → 0 (missing or garbage sensor data). */
function sanitize(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Ceiling on a plausible walking stride — guards absurd height inputs. */
const MAX_STRIDE_M = 1.2;

/**
 * Walking stride length from height. Heuristic: stride ≈ 41.4% of height,
 * i.e. heightCm × 0.00414 meters. Clamped to [0, 1.2 m]; unknown height → 0.
 */
export function strideMeters(heightCm: number): number {
  return Math.min(MAX_STRIDE_M, sanitize(heightCm) * 0.00414);
}

/** Distance walked for a step count, in km (0 when height is unknown). */
export function stepsToKm(steps: number, heightCm: number): number {
  return (sanitize(steps) * strideMeters(heightCm)) / 1000;
}

/**
 * Calories burned walking. Heuristic: ~0.53 kcal per kg of bodyweight per km
 * walked (net of resting burn). Rounded to a whole kcal.
 */
export function stepsKcal(steps: number, weightKg: number, heightCm: number): number {
  return Math.round(0.53 * sanitize(weightKg) * stepsToKm(steps, heightCm));
}

/** MET value for general resistance training (Compendium of Physical Activities). */
const RESISTANCE_TRAINING_MET = 5.0;

/**
 * Calories burned in a logged workout. Heuristic: kcal ≈ MET × kg × hours
 * with MET 5.0 (resistance training). Rounded to a whole kcal.
 */
export function workoutKcal(durationSec: number, weightKg: number): number {
  const hours = sanitize(durationSec) / 3600;
  return Math.round(RESISTANCE_TRAINING_MET * sanitize(weightKg) * hours);
}

/**
 * Resting (basal) calories for a full day — Mifflin-St Jeor BMR reused from
 * macros.ts. Estimate only; floored at 0 for degenerate inputs.
 */
export function restingKcal(input: {
  sex: 'male' | 'female';
  weightKg: number;
  heightCm: number;
  age: number;
}): number {
  return Math.max(
    0,
    bmr(input.sex, sanitize(input.weightKg), sanitize(input.heightCm), sanitize(input.age)),
  );
}

/**
 * Total estimated calories out for the day: resting burn + walking + workouts.
 * Each part is sanitized so one bad reading can't poison the total.
 */
export function activityCaloriesOut(args: {
  resting: number;
  stepsKcal: number;
  workoutKcal: number;
}): number {
  return Math.round(
    sanitize(args.resting) + sanitize(args.stepsKcal) + sanitize(args.workoutKcal),
  );
}

/**
 * Net energy balance: eaten − out. Negative = deficit — often the goal, so
 * the result is deliberately NOT clamped at 0.
 */
export function netKcal(eatenKcal: number, outKcal: number): number {
  return Math.round(sanitize(eatenKcal) - sanitize(outKcal));
}
