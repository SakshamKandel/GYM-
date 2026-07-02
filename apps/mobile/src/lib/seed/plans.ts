import type { Plan, PlanWorkout } from '@gym/shared';
import { getExercise } from '../exercises';

/**
 * Three starter plan templates (Fat Loss / Muscle / Strength).
 * Exercise ids reference the bundled free-exercise-db library.
 * These are placeholders for the coach's real programming (PROJECT_PLAN §11.4).
 */

interface SeedExercise {
  ex: string; // free-exercise-db id
  sets: number;
  reps: string;
  rest: number;
}

function workout(
  planId: string,
  day: number,
  name: string,
  list: SeedExercise[],
): PlanWorkout {
  return {
    id: `${planId}-d${day}`,
    planId,
    week: 1,
    day,
    name,
    exercises: list.map((s, i) => ({
      id: `${planId}-d${day}-e${i}`,
      exerciseId: s.ex,
      exerciseName: getExercise(s.ex)?.name ?? s.ex,
      sets: s.sets,
      repRange: s.reps,
      restSec: s.rest,
    })),
  };
}

export const SEED_PLANS: Plan[] = [
  {
    id: 'strength-531',
    name: 'STRENGTH BASE',
    tierRequired: 'starter',
    goalType: 'strength',
    weeks: 4,
    daysPerWeek: 3,
    description: 'Heavy compound focus. Squat, bench, deadlift, press — get brutally strong on the big four.',
  },
  {
    id: 'muscle-ppl',
    name: 'MUSCLE BUILDER',
    tierRequired: 'starter',
    goalType: 'muscle',
    weeks: 6,
    daysPerWeek: 3,
    description: 'Push / Pull / Legs. Volume where it matters, 8–12 rep hypertrophy work.',
  },
  {
    id: 'fatloss-full',
    name: 'LEAN MACHINE',
    tierRequired: 'starter',
    goalType: 'fat_loss',
    weeks: 6,
    daysPerWeek: 3,
    description: 'Full-body circuits, short rests. Keep muscle, burn the rest.',
  },
];

export const SEED_PLAN_WORKOUTS: Record<string, PlanWorkout[]> = {
  'strength-531': [
    workout('strength-531', 1, 'SQUAT DAY', [
      { ex: 'Barbell_Squat', sets: 5, reps: '3-5', rest: 180 },
      { ex: 'Leg_Press', sets: 3, reps: '8-10', rest: 120 },
      { ex: 'Lying_Leg_Curls', sets: 3, reps: '8-12', rest: 90 },
      { ex: 'Plank', sets: 3, reps: '30-60s', rest: 60 },
    ]),
    workout('strength-531', 2, 'BENCH DAY', [
      { ex: 'Barbell_Bench_Press_-_Medium_Grip', sets: 5, reps: '3-5', rest: 180 },
      { ex: 'Barbell_Shoulder_Press', sets: 3, reps: '6-8', rest: 150 },
      { ex: 'Dips_-_Triceps_Version', sets: 3, reps: '8-12', rest: 90 },
      { ex: 'Face_Pull', sets: 3, reps: '12-15', rest: 60 },
    ]),
    workout('strength-531', 3, 'DEADLIFT DAY', [
      { ex: 'Barbell_Deadlift', sets: 5, reps: '3-5', rest: 210 },
      { ex: 'Bent_Over_Barbell_Row', sets: 3, reps: '6-8', rest: 150 },
      { ex: 'Pullups', sets: 3, reps: '6-10', rest: 120 },
      { ex: 'Hanging_Leg_Raise', sets: 3, reps: '10-15', rest: 60 },
    ]),
  ],
  'muscle-ppl': [
    workout('muscle-ppl', 1, 'PUSH', [
      { ex: 'Barbell_Bench_Press_-_Medium_Grip', sets: 4, reps: '6-10', rest: 150 },
      { ex: 'Incline_Dumbbell_Press', sets: 3, reps: '8-12', rest: 120 },
      { ex: 'Dumbbell_Shoulder_Press', sets: 3, reps: '8-12', rest: 120 },
      { ex: 'Side_Lateral_Raise', sets: 3, reps: '12-15', rest: 60 },
      { ex: 'Triceps_Pushdown', sets: 3, reps: '10-15', rest: 60 },
    ]),
    workout('muscle-ppl', 2, 'PULL', [
      { ex: 'Wide-Grip_Lat_Pulldown', sets: 4, reps: '8-12', rest: 120 },
      { ex: 'Seated_Cable_Rows', sets: 3, reps: '8-12', rest: 120 },
      { ex: 'Bent_Over_Barbell_Row', sets: 3, reps: '8-10', rest: 120 },
      { ex: 'Face_Pull', sets: 3, reps: '12-15', rest: 60 },
      { ex: 'Barbell_Curl', sets: 3, reps: '10-12', rest: 60 },
    ]),
    workout('muscle-ppl', 3, 'LEGS', [
      { ex: 'Barbell_Squat', sets: 4, reps: '6-10', rest: 180 },
      { ex: 'Romanian_Deadlift', sets: 3, reps: '8-12', rest: 150 },
      { ex: 'Leg_Press', sets: 3, reps: '10-12', rest: 120 },
      { ex: 'Leg_Extensions', sets: 3, reps: '12-15', rest: 60 },
      { ex: 'Standing_Calf_Raises', sets: 4, reps: '12-15', rest: 60 },
    ]),
  ],
  'fatloss-full': [
    workout('fatloss-full', 1, 'FULL BODY A', [
      { ex: 'Goblet_Squat', sets: 3, reps: '12-15', rest: 60 },
      { ex: 'Pushups', sets: 3, reps: '10-20', rest: 60 },
      { ex: 'Bent_Over_Two-Dumbbell_Row', sets: 3, reps: '12-15', rest: 60 },
      { ex: 'Dumbbell_Lunges', sets: 3, reps: '10-12', rest: 60 },
      { ex: 'Plank', sets: 3, reps: '30-60s', rest: 45 },
    ]),
    workout('fatloss-full', 2, 'FULL BODY B', [
      { ex: 'Romanian_Deadlift', sets: 3, reps: '10-12', rest: 90 },
      { ex: 'Dumbbell_Bench_Press', sets: 3, reps: '10-15', rest: 60 },
      { ex: 'Wide-Grip_Lat_Pulldown', sets: 3, reps: '12-15', rest: 60 },
      { ex: 'Side_Lateral_Raise', sets: 3, reps: '15-20', rest: 45 },
      { ex: 'Hanging_Leg_Raise', sets: 3, reps: '10-15', rest: 45 },
    ]),
    workout('fatloss-full', 3, 'FULL BODY C', [
      { ex: 'Leg_Press', sets: 3, reps: '12-15', rest: 60 },
      { ex: 'Dumbbell_Shoulder_Press', sets: 3, reps: '10-15', rest: 60 },
      { ex: 'Seated_Cable_Rows', sets: 3, reps: '12-15', rest: 60 },
      { ex: 'Hammer_Curls', sets: 2, reps: '12-15', rest: 45 },
      { ex: 'Triceps_Pushdown', sets: 2, reps: '12-15', rest: 45 },
    ]),
  ],
};

export function getPlan(planId: string): Plan | undefined {
  return SEED_PLANS.find((p) => p.id === planId);
}

export function getPlanWorkouts(planId: string): PlanWorkout[] {
  return SEED_PLAN_WORKOUTS[planId] ?? [];
}

export function getPlanWorkout(planWorkoutId: string): PlanWorkout | undefined {
  for (const workouts of Object.values(SEED_PLAN_WORKOUTS)) {
    const found = workouts.find((w) => w.id === planWorkoutId);
    if (found) return found;
  }
  return undefined;
}
