import { mealDeliveryConfig } from '@gym/db';
import type { MealDeliveryConfig } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { loadDeliveryConfig } from '@/lib/meals';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin — the meal-delivery fee + cutoff editor for the `meal_delivery_config`
 * singleton (id='singleton'). Every member quote, order and subscription cycle
 * reads this row through `loadDeliveryConfig`; until now it had NO editor at
 * all, so changing a fee meant hand-writing the row in the database.
 *
 *  - GET   → { config, updatedAt, updatedBy, persisted }. `persisted:false`
 *    means the row does not exist yet and the returned values are the frozen
 *    @gym/shared defaults the engine is currently falling back to.
 *  - PATCH → partial update. Any subset of the six fields may be sent; the rest
 *    keep their current (or default) value, so two admins editing different
 *    fields don't clobber each other. Upserts the singleton, stamps
 *    `updatedBy`/`updatedAt`, and audits before/after.
 *
 * Guarded by requirePermission('partners.manage') — the existing key for admin
 * ownership of the meal-delivery vertical (same gate as the partner CRUD and
 * the all-partner reconciliation route). No new permission key is introduced.
 */

/** Rs 10,000 in paisa — a generous ceiling that still rejects fat-fingered fees. */
const MAX_FEE_MINOR = 1_000_000;
/** Rs 100,000 in paisa — ceiling for the two order-size thresholds. */
const MAX_THRESHOLD_MINOR = 10_000_000;

const feeMinor = z.number().int().min(0).max(MAX_FEE_MINOR);
const thresholdMinor = z.number().int().min(0).max(MAX_THRESHOLD_MINOR);
const cutoffHour = z.number().int().min(0).max(23);

const patchSchema = z
  .object({
    smallOrderFeeMinor: feeMinor.optional(),
    smallOrderThresholdMinor: thresholdMinor.optional(),
    deliveryFeeMinor: feeMinor.optional(),
    freeDeliveryThresholdMinor: thresholdMinor.optional(),
    lunchCutoffPrevDayHour: cutoffHour.optional(),
    dinnerCutoffSameDayHour: cutoffHour.optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

export function OPTIONS() {
  return preflight();
}

/** The singleton row's audit metadata, or nulls when it has never been saved. */
async function loadMeta(): Promise<{
  updatedAt: string | null;
  updatedBy: string | null;
  persisted: boolean;
}> {
  const rows = await getDb()
    .select({ updatedAt: mealDeliveryConfig.updatedAt, updatedBy: mealDeliveryConfig.updatedBy })
    .from(mealDeliveryConfig)
    .where(eq(mealDeliveryConfig.id, 'singleton'))
    .limit(1);
  const row = rows[0];
  if (!row) return { updatedAt: null, updatedBy: null, persisted: false };
  return {
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    persisted: true,
  };
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const [config, meta] = await Promise.all([loadDeliveryConfig(db), loadMeta()]);
  return json({ config, ...meta }, 200);
}

export async function PATCH(req: Request) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  // Merge onto whatever the engine currently reads (the persisted row, or the
  // @gym/shared defaults on a fresh install) so a partial PATCH never resets an
  // untouched field back to its default.
  const before = await loadDeliveryConfig(db);
  const after: MealDeliveryConfig = { ...before, ...parsed.data };

  // No cross-field policy is imposed beyond the per-field bounds above: every
  // combination is meaningful to `computeFees` (e.g. a 0 free-delivery
  // threshold legitimately means "delivery is always free"), so inventing one
  // here would only block operator intent the pricing engine already supports.
  const now = new Date();
  await db
    .insert(mealDeliveryConfig)
    .values({ id: 'singleton', ...after, updatedAt: now, updatedBy: principal.id })
    .onConflictDoUpdate({
      target: mealDeliveryConfig.id,
      set: { ...after, updatedAt: now, updatedBy: principal.id },
    });

  await logAudit(
    principal,
    'meals.config.update',
    'meal_delivery_config',
    'singleton',
    { before, after, changed: Object.keys(parsed.data) },
    clientIp(req),
  );

  return json(
    {
      config: after,
      updatedAt: now.toISOString(),
      updatedBy: principal.id,
      persisted: true,
    },
    200,
  );
}
