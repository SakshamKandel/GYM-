import { config } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
import { createDb } from '../index';
import { exercises, planExercises, planWorkouts, plans } from '../schema';

/**
 * Optional one-time import of the three curated launch plans that previously
 * lived in the mobile bundle. Neon remains the runtime source of truth after
 * import; this script is never run by build/deploy and never overwrites an
 * admin plan whose description differs from the curated definition.
 *
 * Prerequisite: `pnpm --filter @gym/db seed:exercises`
 * Run explicitly: `pnpm --filter @gym/db seed:training-catalog`
 */

config({ path: '../../.env' });

interface CuratedExercise {
  id: string;
  sets: number;
  reps: string;
  restSec: number;
}

interface CuratedWorkout {
  id: string;
  day: number;
  name: string;
  exercises: CuratedExercise[];
}

interface CuratedPlan {
  id: string;
  name: string;
  goalType: 'fat_loss' | 'muscle' | 'strength';
  weeks: number;
  description: string;
  workouts: CuratedWorkout[];
}

const CURATED_PLANS: CuratedPlan[] = [
  {
    id: 'strength-531',
    name: 'STRENGTH BASE',
    goalType: 'strength',
    weeks: 4,
    description: 'Heavy compound focus. Squat, bench, deadlift, press — get brutally strong on the big four.',
    workouts: [
      { id: 'strength-531-d1', day: 1, name: 'SQUAT DAY', exercises: [
        { id: 'Barbell_Squat', sets: 5, reps: '3-5', restSec: 180 },
        { id: 'Leg_Press', sets: 3, reps: '8-10', restSec: 120 },
        { id: 'Lying_Leg_Curls', sets: 3, reps: '8-12', restSec: 90 },
        { id: 'Plank', sets: 3, reps: '30-60s', restSec: 60 },
      ] },
      { id: 'strength-531-d2', day: 2, name: 'BENCH DAY', exercises: [
        { id: 'Barbell_Bench_Press_-_Medium_Grip', sets: 5, reps: '3-5', restSec: 180 },
        { id: 'Barbell_Shoulder_Press', sets: 3, reps: '6-8', restSec: 150 },
        { id: 'Dips_-_Triceps_Version', sets: 3, reps: '8-12', restSec: 90 },
        { id: 'Face_Pull', sets: 3, reps: '12-15', restSec: 60 },
      ] },
      { id: 'strength-531-d3', day: 3, name: 'DEADLIFT DAY', exercises: [
        { id: 'Barbell_Deadlift', sets: 5, reps: '3-5', restSec: 210 },
        { id: 'Bent_Over_Barbell_Row', sets: 3, reps: '6-8', restSec: 150 },
        { id: 'Pullups', sets: 3, reps: '6-10', restSec: 120 },
        { id: 'Hanging_Leg_Raise', sets: 3, reps: '10-15', restSec: 60 },
      ] },
    ],
  },
  {
    id: 'muscle-ppl',
    name: 'MUSCLE BUILDER',
    goalType: 'muscle',
    weeks: 6,
    description: 'Push / Pull / Legs. Volume where it matters, 8–12 rep hypertrophy work.',
    workouts: [
      { id: 'muscle-ppl-d1', day: 1, name: 'PUSH', exercises: [
        { id: 'Barbell_Bench_Press_-_Medium_Grip', sets: 4, reps: '6-10', restSec: 150 },
        { id: 'Incline_Dumbbell_Press', sets: 3, reps: '8-12', restSec: 120 },
        { id: 'Dumbbell_Shoulder_Press', sets: 3, reps: '8-12', restSec: 120 },
        { id: 'Side_Lateral_Raise', sets: 3, reps: '12-15', restSec: 60 },
        { id: 'Triceps_Pushdown', sets: 3, reps: '10-15', restSec: 60 },
      ] },
      { id: 'muscle-ppl-d2', day: 2, name: 'PULL', exercises: [
        { id: 'Wide-Grip_Lat_Pulldown', sets: 4, reps: '8-12', restSec: 120 },
        { id: 'Seated_Cable_Rows', sets: 3, reps: '8-12', restSec: 120 },
        { id: 'Bent_Over_Barbell_Row', sets: 3, reps: '8-10', restSec: 120 },
        { id: 'Face_Pull', sets: 3, reps: '12-15', restSec: 60 },
        { id: 'Barbell_Curl', sets: 3, reps: '10-12', restSec: 60 },
      ] },
      { id: 'muscle-ppl-d3', day: 3, name: 'LEGS', exercises: [
        { id: 'Barbell_Squat', sets: 4, reps: '6-10', restSec: 180 },
        { id: 'Romanian_Deadlift', sets: 3, reps: '8-12', restSec: 150 },
        { id: 'Leg_Press', sets: 3, reps: '10-12', restSec: 120 },
        { id: 'Leg_Extensions', sets: 3, reps: '12-15', restSec: 60 },
        { id: 'Standing_Calf_Raises', sets: 4, reps: '12-15', restSec: 60 },
      ] },
    ],
  },
  {
    id: 'fatloss-full',
    name: 'LEAN MACHINE',
    goalType: 'fat_loss',
    weeks: 6,
    description: 'Full-body circuits, short rests. Keep muscle, burn the rest.',
    workouts: [
      { id: 'fatloss-full-d1', day: 1, name: 'FULL BODY A', exercises: [
        { id: 'Goblet_Squat', sets: 3, reps: '12-15', restSec: 60 },
        { id: 'Pushups', sets: 3, reps: '10-20', restSec: 60 },
        { id: 'Bent_Over_Two-Dumbbell_Row', sets: 3, reps: '12-15', restSec: 60 },
        { id: 'Dumbbell_Lunges', sets: 3, reps: '10-12', restSec: 60 },
        { id: 'Plank', sets: 3, reps: '30-60s', restSec: 45 },
      ] },
      { id: 'fatloss-full-d2', day: 2, name: 'FULL BODY B', exercises: [
        { id: 'Romanian_Deadlift', sets: 3, reps: '10-12', restSec: 90 },
        { id: 'Dumbbell_Bench_Press', sets: 3, reps: '10-15', restSec: 60 },
        { id: 'Wide-Grip_Lat_Pulldown', sets: 3, reps: '12-15', restSec: 60 },
        { id: 'Side_Lateral_Raise', sets: 3, reps: '15-20', restSec: 45 },
        { id: 'Hanging_Leg_Raise', sets: 3, reps: '10-15', restSec: 45 },
      ] },
      { id: 'fatloss-full-d3', day: 3, name: 'FULL BODY C', exercises: [
        { id: 'Leg_Press', sets: 3, reps: '12-15', restSec: 60 },
        { id: 'Dumbbell_Shoulder_Press', sets: 3, reps: '10-15', restSec: 60 },
        { id: 'Seated_Cable_Rows', sets: 3, reps: '12-15', restSec: 60 },
        { id: 'Hammer_Curls', sets: 2, reps: '12-15', restSec: 45 },
        { id: 'Triceps_Pushdown', sets: 2, reps: '12-15', restSec: 45 },
      ] },
    ],
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (expected in repo-root .env)');
  const db = createDb(databaseUrl);

  const requiredExerciseIds = [
    ...new Set(CURATED_PLANS.flatMap((plan) => plan.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.id)))),
  ];
  const foundExercises = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(inArray(exercises.id, requiredExerciseIds));
  const foundIds = new Set(foundExercises.map((row) => row.id));
  const missingIds = requiredExerciseIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(`Missing ${missingIds.length} exercises. Run seed:exercises first: ${missingIds.join(', ')}`);
  }

  let imported = 0;
  let skipped = 0;
  for (const plan of CURATED_PLANS) {
    const existing = await db
      .select({ id: plans.id, description: plans.description })
      .from(plans)
      .where(eq(plans.id, plan.id))
      .limit(1);
    if (existing[0] && existing[0].description !== plan.description) {
      console.log(`Skipped ${plan.id}: an admin-authored plan already owns that id.`);
      skipped += 1;
      continue;
    }

    await db.insert(plans).values({
      id: plan.id,
      name: plan.name,
      tierRequired: 'starter',
      goalType: plan.goalType,
      weeks: plan.weeks,
      daysPerWeek: plan.workouts.length,
      description: plan.description,
      isBranded: false,
    }).onConflictDoNothing({ target: plans.id });

    for (const workout of plan.workouts) {
      await db.insert(planWorkouts).values({
        id: workout.id,
        planId: plan.id,
        week: 1,
        day: workout.day,
        name: workout.name,
      }).onConflictDoNothing({ target: planWorkouts.id });

      await db.insert(planExercises).values(
        workout.exercises.map((exercise, position) => ({
          id: `${workout.id}-e${position}`,
          planWorkoutId: workout.id,
          exerciseId: exercise.id,
          position,
          sets: exercise.sets,
          repRange: exercise.reps,
          restSec: exercise.restSec,
        })),
      ).onConflictDoNothing({ target: planExercises.id });
    }
    imported += 1;
  }

  console.log(`Training catalog import complete: ${imported} imported/repaired, ${skipped} skipped.`);
}

main().catch((error: unknown) => {
  console.error('training catalog seed failed:', error);
  process.exitCode = 1;
});
