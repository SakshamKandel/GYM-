import { planWorkouts, plans } from '@gym/db';
import { asc, count, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin catalog — training plan library (gap build P2-16, content_admin
 * surface). Plans are DB-backed (packages/db/src/schema.ts `plans` +
 * `plan_workouts` + `plan_exercises`).
 *
 * IMPORTANT — this table is NOT yet read by the shipped app. The mobile
 * plan browser sources its plans from a hardcoded constant
 * (apps/mobile/src/lib/seed/plans.ts SEED_PLANS / SEED_PLAN_WORKOUTS,
 * getPlan()/getPlanWorkouts()) and never queries this API or the `plans`
 * table. This CRUD surface is a staging/authoring tool for a future mobile
 * catalog sync (see PROJECT_PLAN/gap list); edits made here do not affect
 * what members see until that sync is built. Nested workout/exercise
 * structure is edited as a whole via PATCH /api/admin/catalog/plans/[id]
 * (see that route's doc) rather than a sprawling set of per-workout/per-
 * exercise routes — a plan's structure is small (a handful of workouts × a
 * handful of exercises) and admins edit it as one unit in the builder UI.
 *
 *  - GET  → every plan, with its workout count (not exercise-level detail —
 *    fetch the single-plan route for that).
 *  - POST → create a plan shell (no workouts yet); the builder adds workouts
 *    via the follow-up PATCH.
 *
 * Guarded by requirePermission('catalog.manage').
 */

const TIERS = ['starter', 'silver', 'gold', 'elite'] as const;
const GOALS = ['fat_loss', 'muscle', 'strength'] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  tierRequired: z.enum(TIERS).default('starter'),
  goalType: z.enum(GOALS),
  weeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  description: z.string().trim().max(4000).optional(),
  isBranded: z.boolean().optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

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

  return json(
    { plans: rows.map((r) => ({ ...r, workoutCount: workoutCountMap.get(r.id) ?? 0 })) },
    200,
  );
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { name, tierRequired, goalType, weeks, daysPerWeek, description, isBranded } = parsed.data;

  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(plans).values({
    id,
    name,
    tierRequired,
    goalType,
    weeks,
    daysPerWeek,
    description: description ?? '',
    isBranded: isBranded ?? false,
  });

  await logAudit(principal, 'catalog.plan.create', 'plan', id, { name, tierRequired }, clientIp(req));

  return json({ id }, 201);
}
