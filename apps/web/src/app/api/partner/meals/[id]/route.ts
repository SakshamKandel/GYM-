import { mealPartners, meals } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { guardedMealPatchSql, guardedMealSoftDeleteSql } from '@/lib/meals';
import { partnerOperationLockSql } from '@/lib/partnerOperationLock';
import { isOwnImageDeliveryUrl } from '@/lib/uploads';

export const runtime = 'nodejs';

/**
 * Partner menu CRUD — item endpoints (§3). Every write is scoped
 * `WHERE id AND partnerId=<caller's own>` so a cross-restaurant edit matches 0
 * rows → 404 (§2 threat: cross-restaurant meal edit). DELETE is a SOFT delete
 * (`isDeleted=true`) so historical order-item snapshots keep resolving.
 *
 * Taking an item OFF the menu is guarded the same way on both paths: DELETE and
 * `PATCH {isActive:false}` refuse while a live fixed-meal subscription still
 * selects the dish (409 `fixed_subscription_in_use` + `subscriptionCount`),
 * because a dish that disappears mid-plan stops the subscriber's deliveries
 * while their weekly billing keeps running.
 */

const macroInt = z.number().int().min(0).max(100_000);

/**
 * Mirrors the create route: a dish photo must be a delivery URL our own POST
 * /api/uploads/image minted for `kind: 'meal_photo'`, the same check every other
 * image field runs. Enforcing it only on create would leave the edit path as an
 * open door to any host.
 */
const mealImageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => isOwnImageDeliveryUrl(v, ['meal_photo']),
    'imageUrl must be a delivery URL minted by /api/uploads/image',
  );

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000),
    imageUrl: mealImageUrl.nullable(),
    kcal: macroInt,
    proteinG: macroInt,
    carbsG: macroInt,
    fatG: macroInt,
    fiberG: macroInt.nullable(),
    sugarG: macroInt.nullable(),
    dietType: z.enum(['veg', 'non_veg', 'egg']),
    goalTags: z.array(z.enum(['cutting', 'bulking', 'balanced'])).max(3),
    // A live menu item must carry a real price — mirror the POST floor so a
    // blank/zero price can't silently publish a free dish on the update path
    // (P0-15).
    priceMinor: z.number().int().min(1).max(100_000_000),
    currency: z.enum(['NPR', 'USD']),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .partial();

/** `count(*)::integer` comes back as a number or a string depending on driver. */
function subscriptionCountOf(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  if (Object.keys(parsed.data).length === 0) return json({ error: 'no_fields' }, 400);

  const db = getDb();

  // A meal's currency MUST match the partner's own account currency. A mismatch
  // (e.g. patching an NPR dish to USD) corrupts every downstream revenue rollup,
  // which sums minor units without re-checking currency. The sibling POST route
  // enforces this on create; the update path must too (P0-15).
  if (parsed.data.currency !== undefined) {
    const [account] = await db
      .select({ currency: mealPartners.currency })
      .from(mealPartners)
      .where(eq(mealPartners.id, partnerId))
      .limit(1);
    if (!account) return json({ error: 'forbidden' }, 403);
    if (parsed.data.currency !== account.currency) {
      return json({ error: 'currency_mismatch', expected: account.currency }, 400);
    }
  }

  // Deactivation is a menu removal in disguise, so it runs the DELETE path's
  // in-use guard under the SAME partner mutex — one statement applies every
  // patched column, or (when a live fixed plan depends on the dish) none of
  // them. Ordinary edits keep the plain scoped UPDATE below.
  if (parsed.data.isActive === false) {
    const [, patchResult] = await db.batch([
      db.execute(partnerOperationLockSql(partnerId)),
      db.execute(guardedMealPatchSql({ mealId: id, partnerId, now: new Date(), patch: parsed.data })),
    ]);
    const row = patchResult.rows[0];
    const outcome = row && typeof row.outcome === 'string' ? row.outcome : 'conflict';
    if (outcome === 'not_found') return json({ error: outcome }, 404);
    if (outcome === 'fixed_subscription_in_use') {
      return json(
        { error: outcome, subscriptionCount: subscriptionCountOf(row?.subscription_count) },
        409,
      );
    }
    if (outcome !== 'updated') return json({ error: 'conflict' }, 409);

    const [patched] = await db
      .select()
      .from(meals)
      .where(and(eq(meals.id, id), eq(meals.partnerId, partnerId), eq(meals.isDeleted, false)))
      .limit(1);
    if (!patched) return json({ error: 'not_found' }, 404);
    return json({ meal: patched }, 200);
  }

  const [meal] = await db
    .update(meals)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(meals.id, id), eq(meals.partnerId, partnerId), eq(meals.isDeleted, false)))
    .returning();
  if (!meal) return json({ error: 'not_found' }, 404);

  return json({ meal }, 200);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const { id } = await ctx.params;
  const db = getDb();
  const [, deleteResult] = await db.batch([
    db.execute(partnerOperationLockSql(partnerId)),
    db.execute(guardedMealSoftDeleteSql({ mealId: id, partnerId, now: new Date() })),
  ]);
  const row = deleteResult.rows[0];
  const outcome = row && typeof row.outcome === 'string' ? row.outcome : 'conflict';
  if (outcome === 'not_found') return json({ error: outcome }, 404);
  if (outcome === 'fixed_subscription_in_use') {
    return json(
      { error: outcome, subscriptionCount: subscriptionCountOf(row?.subscription_count) },
      409,
    );
  }
  if (outcome !== 'deleted') return json({ error: 'conflict' }, 409);

  return json({ ok: true }, 200);
}
