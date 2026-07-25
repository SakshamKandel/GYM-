import { exercises, mealDeliveryConfig, planExercises, planWorkouts, plans } from '@gym/db';
import { asc, count, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { loadDeliveryConfig } from '@/lib/meals';
import { staffFromCookie } from '@/lib/staffSession';
import { CatalogManager } from './_components/CatalogManager';
import { DeliverySettingsForm } from './_components/DeliverySettingsForm';
import type { ExerciseRow, PlanRow } from './_components/types';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Exercises & plans' };
export const dynamic = 'force-dynamic';

/**
 * Admin content — exercise/plan catalog CRUD (gap build P2-16). Mirrors the
 * projections GET /api/admin/catalog/exercises and .../plans return so the
 * initial render needs no client fetch; every mutation (create/edit/delete,
 * and the plan workout/exercise structure editor) goes through the guarded
 * /api/admin/catalog/* routes from the client component.
 *
 * Distinct from `admin/content` (WP6's plan-VIDEO library) — this page
 * manages the exercises/plans/plan_workouts/plan_exercises tables published
 * to signed-in members through GET /api/me/training-catalog.
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

/**
 * The meal-delivery fee/cutoff singleton plus when it was last saved.
 * `loadDeliveryConfig` already falls back to the frozen @gym/shared defaults on
 * a fresh install; `persisted` tells the editor whether it is showing a real
 * row or those defaults.
 */
async function loadMealDeliveryConfig() {
  const db = getDb();
  const [config, metaRows] = await Promise.all([
    loadDeliveryConfig(db),
    db
      .select({ updatedAt: mealDeliveryConfig.updatedAt })
      .from(mealDeliveryConfig)
      .where(eq(mealDeliveryConfig.id, 'singleton'))
      .limit(1),
  ]);
  const meta = metaRows[0];
  return {
    config,
    updatedAt: meta ? meta.updatedAt.toISOString() : null,
    persisted: Boolean(meta),
  };
}

export default async function AdminCatalogPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('catalog.manage')) redirect('/admin');

  const [exerciseRows, planRows] = await Promise.all([loadExercises(), loadPlans()]);

  // The meal-delivery fee/cutoff editor rides along on this page (it needs no
  // nav item of its own) but is a DIFFERENT capability: it appears only for
  // staff who also hold 'partners.manage', the key that already owns the
  // meal-delivery vertical. A content_admin with catalog.manage alone never
  // sees it, matching what PATCH /api/admin/meal-config enforces.
  const canManageDelivery = permissions.has('partners.manage');
  const delivery = canManageDelivery ? await loadMealDeliveryConfig() : null;

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Exercises & plans"
        subtitle="Source of truth for the member exercise and plan library. Signed-in members receive saved edits on their next catalog refresh; offline devices show their last verified download. Deleting an exercise still used by a plan is blocked until it's removed from that plan."
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

      {delivery ? (
        <DeliverySettingsForm
          config={delivery.config}
          updatedAt={delivery.updatedAt}
          persisted={delivery.persisted}
        />
      ) : null}
    </div>
  );
}
