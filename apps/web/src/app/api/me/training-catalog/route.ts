import { createHash } from 'node:crypto';
import { exercises, planExercises, planWorkouts, plans } from '@gym/db';
import { canAccessTrainingPlan, trainingCatalogSchema } from '@gym/shared';
import type { TrainingCatalog, TrainingCatalogPlan } from '@gym/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/** A catalog revision as this route mints it: sha256, lowercase hex. */
const REVISION_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Authenticated member snapshot of the admin-authored Neon training catalog.
 * Locked plans expose metadata only; workout structure remains server-gated
 * through the shared hasEntitlement path.
 *
 * OPTIONAL conditional read: a caller that already holds a snapshot may pass
 * `?revision=<the revision it holds>`. When that still matches the revision
 * this request just computed, the answer is a tiny
 * `{ notModified: true, revision }` instead of the whole exercise library the
 * device already has byte for byte. Everything else is unchanged — a request
 * without the parameter (every shipped client) gets exactly the body it always
 * got, and the not-modified answer is only ever produced from the revision
 * computed by THIS request, so a genuine content change always falls through
 * to the full body on the very next read.
 */
export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // Read the caller's revision here, but compare it only once the real content
  // has been built and validated below (never against a cheaper shortcut that
  // could drift from what we would actually serve).
  const knownRevision = new URL(req.url).searchParams.get('revision');

  const db = getDb();
  const [planRows, exerciseRows] = await Promise.all([
    db
      .select({
        id: plans.id,
        name: plans.name,
        tierRequired: plans.tierRequired,
        goalType: plans.goalType,
        weeks: plans.weeks,
        daysPerWeek: plans.daysPerWeek,
        description: plans.description,
        isBranded: plans.isBranded,
      })
      .from(plans)
      .orderBy(asc(plans.name), asc(plans.id)),
    db
      .select({
        id: exercises.id,
        name: exercises.name,
        muscleGroup: exercises.muscleGroup,
        secondaryMuscles: exercises.secondaryMuscles,
        equipment: exercises.equipment,
        level: exercises.level,
        category: exercises.category,
        instructions: exercises.instructions,
        imageUrls: exercises.imageUrls,
      })
      .from(exercises)
      .orderBy(asc(exercises.name), asc(exercises.id)),
  ]);

  const availablePlanIds = planRows
    .filter((plan) => canAccessTrainingPlan(user, plan))
    .map((plan) => plan.id);

  const workoutRows =
    availablePlanIds.length === 0
      ? []
      : await db
          .select({
            id: planWorkouts.id,
            planId: planWorkouts.planId,
            week: planWorkouts.week,
            day: planWorkouts.day,
            name: planWorkouts.name,
          })
          .from(planWorkouts)
          .where(inArray(planWorkouts.planId, availablePlanIds))
          .orderBy(
            asc(planWorkouts.planId),
            asc(planWorkouts.week),
            asc(planWorkouts.day),
            asc(planWorkouts.id),
          );

  const workoutIds = workoutRows.map((workout) => workout.id);
  const planExerciseRows =
    workoutIds.length === 0
      ? []
      : await db
          .select({
            id: planExercises.id,
            planWorkoutId: planExercises.planWorkoutId,
            exerciseId: planExercises.exerciseId,
            exerciseName: exercises.name,
            sets: planExercises.sets,
            repRange: planExercises.repRange,
            restSec: planExercises.restSec,
            position: planExercises.position,
          })
          .from(planExercises)
          .innerJoin(exercises, eq(exercises.id, planExercises.exerciseId))
          .where(inArray(planExercises.planWorkoutId, workoutIds))
          .orderBy(
            asc(planExercises.planWorkoutId),
            asc(planExercises.position),
            asc(planExercises.id),
          );

  const exercisesByWorkout = new Map<string, typeof planExerciseRows>();
  for (const exercise of planExerciseRows) {
    const rows = exercisesByWorkout.get(exercise.planWorkoutId) ?? [];
    rows.push(exercise);
    exercisesByWorkout.set(exercise.planWorkoutId, rows);
  }

  const workoutsByPlan = new Map<string, TrainingCatalogPlan['workouts']>();
  for (const workout of workoutRows) {
    const rows = workoutsByPlan.get(workout.planId) ?? [];
    rows.push({
      id: workout.id,
      planId: workout.planId,
      week: workout.week,
      day: workout.day,
      name: workout.name,
      exercises: (exercisesByWorkout.get(workout.id) ?? []).map((exercise) => ({
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        sets: exercise.sets,
        repRange: exercise.repRange,
        restSec: exercise.restSec,
      })),
    });
    workoutsByPlan.set(workout.planId, rows);
  }

  const catalogPlans: TrainingCatalogPlan[] = planRows.map((plan) => {
    const isAvailable = canAccessTrainingPlan(user, plan);
    return {
      ...plan,
      isAvailable,
      workouts: isAvailable ? (workoutsByPlan.get(plan.id) ?? []) : [],
    };
  });

  const content = { plans: catalogPlans, exercises: exerciseRows };
  const catalog: TrainingCatalog = {
    revision: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    generatedAt: new Date().toISOString(),
    ...content,
  };

  const parsed = trainingCatalogSchema.safeParse(catalog);
  if (!parsed.success) return json({ error: 'invalid_catalog' }, 500);

  if (
    knownRevision !== null &&
    REVISION_PATTERN.test(knownRevision) &&
    knownRevision === parsed.data.revision
  ) {
    return json({ notModified: true, revision: parsed.data.revision }, 200);
  }

  return json(parsed.data, 200);
}
