import { createHash } from 'node:crypto';
import { exercises, planExercises, planWorkouts, plans, type Db } from '@gym/db';
import { canAccessTrainingPlan, trainingCatalogSchema } from '@gym/shared';
import type { TrainingCatalog, TrainingCatalogPlan } from '@gym/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/** A catalog revision as this route mints it: sha256, lowercase hex. */
const REVISION_PATTERN = /^[a-f0-9]{64}$/;

/**
 * The revision this process last minted for a given tier, and the state of the
 * catalog tables it was minted from.
 *
 * The conditional read used to save the download and nothing else: the whole
 * 854 KB snapshot was still assembled, hashed and schema-checked before the
 * route could tell the caller "you already have this". The memo lets a matching
 * revision be answered from a single small query instead.
 *
 * It can only ever answer "unchanged", never "changed", and only when the
 * fingerprint below still matches, so a stale answer needs the catalog content
 * to change WITHOUT changing its fingerprint — which the fingerprint is built
 * to make impossible. Anything else (cold process, an edit, an unknown tier)
 * simply falls through to the full path, exactly as before.
 *
 * Keyed by tier because that is the only thing the payload varies on
 * (`canAccessTrainingPlan` reads nothing else), so at most four entries exist.
 */
const revisionMemo = new Map<string, { fingerprint: string; revision: string }>();

/**
 * A content fingerprint of every table the snapshot is built from: an md5 over
 * each row's full text, so an insert, a delete or an edit to any single field
 * all change it. Cheap because nothing crosses the wire but four short strings.
 *
 * Returns null if it cannot be computed, which just means "no short-circuit".
 */
async function catalogFingerprint(db: Db): Promise<string | null> {
  try {
    const result = await db.execute(sql`
      select
        (select coalesce(md5(string_agg(md5(p::text), '' order by p.id)), '') from ${plans} p) as plans,
        (select coalesce(md5(string_agg(md5(e::text), '' order by e.id)), '') from ${exercises} e) as exercises,
        (select coalesce(md5(string_agg(md5(w::text), '' order by w.id)), '') from ${planWorkouts} w) as workouts,
        (select coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from ${planExercises} x) as plan_exercises
    `);
    const row = result.rows[0];
    if (!row) return null;
    const parts = [row.plans, row.exercises, row.workouts, row.plan_exercises];
    if (!parts.every((part): part is string => typeof part === 'string')) return null;
    return parts.join(':');
  } catch (err) {
    console.error('[training-catalog] fingerprint failed — serving the full snapshot', err);
    return null;
  }
}

/**
 * Authenticated member snapshot of the admin-authored Neon training catalog.
 * Locked plans expose metadata only; workout structure remains server-gated
 * through the shared hasEntitlement path.
 *
 * OPTIONAL conditional read: a caller that already holds a snapshot may pass
 * `?revision=<the revision it holds>`. When that still matches the revision the
 * catalog currently hashes to, the answer is a tiny
 * `{ notModified: true, revision }` instead of the whole exercise library the
 * device already has byte for byte. Everything else is unchanged — a request
 * without the parameter (every shipped client) gets exactly the body it always
 * got, and the not-modified answer is only ever produced for content this
 * process has itself hashed and schema-checked, with the content fingerprint
 * below still matching, so a genuine change always falls through to the full
 * body on the very next read.
 */
export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const knownRevision = new URL(req.url).searchParams.get('revision');
  const conditional = knownRevision !== null && REVISION_PATTERN.test(knownRevision);

  const db = getDb();

  // Only a conditional read pays for the fingerprint, and it pays BEFORE a
  // single catalog row is read: pairing it with a revision computed afterwards
  // can only ever make the memo look older than the content, which costs a
  // rebuild. The other order could make it look newer, which would serve a
  // stale "unchanged". A caller that sends no revision (every shipped client)
  // takes exactly the path it always took.
  const fingerprint = conditional ? await catalogFingerprint(db) : null;
  if (fingerprint !== null) {
    const memo = revisionMemo.get(user.tier);
    if (memo && memo.fingerprint === fingerprint && memo.revision === knownRevision) {
      return json({ notModified: true, revision: memo.revision }, 200);
    }
  }

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

  // Remember what this content hashed to, so the next caller holding this
  // revision can be answered without building it again. Only ever recorded
  // after the content has passed its own schema check.
  if (fingerprint !== null) {
    revisionMemo.set(user.tier, { fingerprint, revision: parsed.data.revision });
  }

  if (conditional && knownRevision === parsed.data.revision) {
    return json({ notModified: true, revision: parsed.data.revision }, 200);
  }

  return json(parsed.data, 200);
}
