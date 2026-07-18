import { exercises, planExercises, planWorkouts, plans } from '@gym/db';
import { asc, count, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { CatalogManager } from './_components/CatalogManager';
import type { ExerciseRow, PlanRow } from './_components/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin content — exercise/plan catalog CRUD (gap build P2-16). Mirrors the
 * projections GET /api/admin/catalog/exercises and .../plans return so the
 * initial render needs no client fetch; every mutation (create/edit/delete,
 * and the plan workout/exercise structure editor) goes through the guarded
 * /api/admin/catalog/* routes from the client component.
 *
 * Distinct from `admin/content` (WP6's plan-VIDEO library) — this page
 * manages the exercises/plans/plan_workouts/plan_exercises tables, which are
 * a staging area only: the shipped mobile app does NOT read from them yet
 * (Train tab uses a bundled free-exercise-db JSON asset; plans come from a
 * hardcoded SEED_PLANS constant in apps/mobile/src/lib/seed/plans.ts). See
 * the doc comments on /api/admin/catalog/exercises and .../plans for detail.
 * The page copy below must not claim otherwise.
 */

async function loadExercises(): Promise<ExerciseRow[]> {
  const db = getDb();
  const rows = await db
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
    .orderBy(asc(exercises.name));

  const ids = rows.map((r) => r.id);
  const usageMap = new Map<string, number>();
  if (ids.length > 0) {
    const usageRows = await db
      .select({ exerciseId: planExercises.exerciseId, n: count() })
      .from(planExercises)
      .where(inArray(planExercises.exerciseId, ids))
      .groupBy(planExercises.exerciseId);
    for (const r of usageRows) usageMap.set(r.exerciseId, Number(r.n));
  }

  return rows.map((r) => ({ ...r, usedByPlanCount: usageMap.get(r.id) ?? 0 }));
}

async function loadPlans(): Promise<PlanRow[]> {
  const db = getDb();
  const rows = await db
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
    .orderBy(asc(plans.name));

  const ids = rows.map((r) => r.id);
  const workoutCountMap = new Map<string, number>();
  if (ids.length > 0) {
    const workoutCountRows = await db
      .select({ planId: planWorkouts.planId, n: count() })
      .from(planWorkouts)
      .where(inArray(planWorkouts.planId, ids))
      .groupBy(planWorkouts.planId);
    for (const r of workoutCountRows) workoutCountMap.set(r.planId, Number(r.n));
  }

  return rows.map((r) => ({ ...r, workoutCount: workoutCountMap.get(r.id) ?? 0 }));
}

export default async function AdminCatalogPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('catalog.manage')) redirect('/admin');

  const [exerciseRows, planRows] = await Promise.all([loadExercises(), loadPlans()]);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Exercise & plan catalog"
        subtitle="Staging area for the exercise & plan library — the shipped mobile app does not read these edits yet (it still ships a bundled exercise list and hardcoded plans). Changes here take effect once the mobile catalog sync ships. Deleting an exercise still used by a plan is blocked until it's removed from that plan."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Exercises" value={exerciseRows.length} />
        <StatTile label="Plans" value={planRows.length} />
      </div>

      <CatalogManager exercises={exerciseRows} plans={planRows} />
    </div>
  );
}
