import { exercises, planExercises, planWorkouts, plans } from '@gym/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin catalog — single plan, including its full workout/exercise structure.
 *
 *  - GET   → plan fields + `workouts[]`, each with its `exercises[]` (ordered
 *    by position), for the builder UI.
 *  - PATCH → top-level fields (name/tier/goal/weeks/daysPerWeek/description/
 *    isBranded) are applied individually when present. When the body also
 *    carries `workouts`, the ENTIRE workout/exercise structure is replaced:
 *    every existing plan_workouts row for this plan is deleted (cascades
 *    plan_exercises) and the supplied array is inserted fresh. This is a
 *    whole-structure replace, not a diff — simpler and safer to reason about
 *    than per-row CRUD for a small nested structure, at the cost of NOT being
 *    atomic (neon-http has no transactions, per project convention): a crash
 *    between the delete and the re-insert would leave the plan's workouts
 *    empty until the admin retries the save. Acceptable for a low-concurrency
 *    internal content tool; flagged here rather than silently assumed safe.
 *    Every `exerciseId` referenced must already exist in the exercise
 *    catalog — an unknown id surfaces as 400 `unknown_exercise` (validated
 *    up front, so a partial delete+insert never happens because of a typo).
 *  - DELETE → cascades workouts + exercises (FK ON DELETE CASCADE).
 *
 * Guarded by requirePermission('catalog.manage').
 */

const TIERS = ['starter', 'silver', 'gold', 'elite'] as const;
const GOALS = ['fat_loss', 'muscle', 'strength'] as const;

const exerciseInputSchema = z.object({
  exerciseId: z.string().trim().min(1).max(120),
  position: z.number().int().min(0).max(200).default(0),
  sets: z.number().int().min(1).max(20),
  repRange: z.string().trim().min(1).max(40),
  restSec: z.number().int().min(0).max(1800).default(120),
});

const workoutInputSchema = z.object({
  week: z.number().int().min(1).max(52),
  day: z.number().int().min(1).max(7),
  name: z.string().trim().min(1).max(200),
  exercises: z.array(exerciseInputSchema).max(60).default([]),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    tierRequired: z.enum(TIERS).optional(),
    goalType: z.enum(GOALS).optional(),
    weeks: z.number().int().min(1).max(52).optional(),
    daysPerWeek: z.number().int().min(1).max(7).optional(),
    description: z.string().trim().max(4000).optional(),
    isBranded: z.boolean().optional(),
    workouts: z.array(workoutInputSchema).max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const planRows = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  const plan = planRows[0];
  if (!plan) return json({ error: 'not_found' }, 404);

  const workoutRows = await db
    .select()
    .from(planWorkouts)
    .where(eq(planWorkouts.planId, id))
    .orderBy(asc(planWorkouts.week), asc(planWorkouts.day));

  const workoutIds = workoutRows.map((w) => w.id);
  const exerciseRows =
    workoutIds.length > 0
      ? await db
          .select({
            id: planExercises.id,
            planWorkoutId: planExercises.planWorkoutId,
            exerciseId: planExercises.exerciseId,
            exerciseName: exercises.name,
            position: planExercises.position,
            sets: planExercises.sets,
            repRange: planExercises.repRange,
            restSec: planExercises.restSec,
          })
          .from(planExercises)
          .leftJoin(exercises, eq(exercises.id, planExercises.exerciseId))
          .where(inArray(planExercises.planWorkoutId, workoutIds))
          .orderBy(asc(planExercises.position))
      : [];

  const byWorkout = new Map<string, typeof exerciseRows>();
  for (const e of exerciseRows) {
    const list = byWorkout.get(e.planWorkoutId) ?? [];
    list.push(e);
    byWorkout.set(e.planWorkoutId, list);
  }

  return json(
    {
      plan,
      workouts: workoutRows.map((w) => ({
        id: w.id,
        week: w.week,
        day: w.day,
        name: w.name,
        exercises: (byWorkout.get(w.id) ?? []).map((e) => ({
          id: e.id,
          exerciseId: e.exerciseId,
          exerciseName: e.exerciseName,
          position: e.position,
          sets: e.sets,
          repRange: e.repRange,
          restSec: e.restSec,
        })),
      })),
    },
    200,
  );
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { workouts, ...topLevel } = parsed.data;

  const db = getDb();

  const existing = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, id)).limit(1);
  if (existing.length === 0) return json({ error: 'not_found' }, 404);

  if (Object.keys(topLevel).length > 0) {
    await db.update(plans).set(topLevel).where(eq(plans.id, id));
  }

  if (workouts !== undefined) {
    // Validate every referenced exerciseId exists BEFORE touching any rows —
    // avoids deleting the current structure only to fail on the re-insert.
    const referencedIds = [...new Set(workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)))];
    if (referencedIds.length > 0) {
      const found = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(inArray(exercises.id, referencedIds));
      const foundIds = new Set(found.map((f) => f.id));
      const missing = referencedIds.filter((rid) => !foundIds.has(rid));
      if (missing.length > 0) {
        return json({ error: 'unknown_exercise', missing }, 400);
      }
    }

    await db.delete(planWorkouts).where(eq(planWorkouts.planId, id));

    for (const w of workouts) {
      const workoutId = crypto.randomUUID();
      await db.insert(planWorkouts).values({
        id: workoutId,
        planId: id,
        week: w.week,
        day: w.day,
        name: w.name,
      });
      if (w.exercises.length > 0) {
        await db.insert(planExercises).values(
          w.exercises.map((e) => ({
            id: crypto.randomUUID(),
            planWorkoutId: workoutId,
            exerciseId: e.exerciseId,
            position: e.position,
            sets: e.sets,
            repRange: e.repRange,
            restSec: e.restSec,
          })),
        );
      }
    }
  }

  await logAudit(
    principal,
    'catalog.plan.update',
    'plan',
    id,
    { fields: Object.keys(topLevel), workoutsReplaced: workouts !== undefined },
    clientIp(req),
  );

  return json({ id }, 200);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const deleted = await db.delete(plans).where(eq(plans.id, id)).returning({ id: plans.id });
  if (deleted.length === 0) return json({ error: 'not_found' }, 404);

  await logAudit(principal, 'catalog.plan.delete', 'plan', id, {}, clientIp(req));

  return json({ id }, 200);
}
