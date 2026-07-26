import { meals, mealPartners } from '@gym/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin — one restaurant's menu: a read view, plus the ability to take a single
 * dish off sale. Guarded by `partners.manage`, like the rest of
 * `/api/admin/partners`.
 *
 *  - GET   → { partnerId, currency, meals } — every non-deleted dish with its
 *            price, its diet type and whether it is currently listed.
 *  - PATCH { mealId } → takes that one dish off the menu (the same `isActive`
 *            flag the restaurant's own menu screen uses, so members stop seeing
 *            it exactly as if the restaurant had unlisted it). Audited.
 *
 * What unlisting reaches, deliberately, is exactly what the restaurant's own
 * toggle reaches: the member menu, the price quote, new orders, and the weekly
 * subscription spawn all filter on `isActive`. Orders already placed keep their
 * snapshotted name and price and are untouched.
 *
 * Deliberately NOT here: creating, pricing, or editing a dish. The restaurant
 * owns its menu. Admin needs one thing the console could not do at all before —
 * take something down — without which the only lever was closing the whole
 * restaurant, which is itself refused while orders are live.
 *
 * Putting a dish back is likewise the restaurant's own call, from its menu
 * screen. Taking one down is a moderation act; putting it back is a menu
 * decision.
 */

const patchSchema = z.object({
  mealId: z.string().trim().min(1),
});

/** The projection both the list read and the unlist reply hand back. */
const mealColumns = {
  id: meals.id,
  name: meals.name,
  priceMinor: meals.priceMinor,
  currency: meals.currency,
  dietType: meals.dietType,
  kcal: meals.kcal,
  isActive: meals.isActive,
  sortOrder: meals.sortOrder,
};

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const [partner] = await db
    .select({ id: mealPartners.id, currency: mealPartners.currency })
    .from(mealPartners)
    .where(eq(mealPartners.id, id))
    .limit(1);
  if (!partner) return json({ error: 'not_found' }, 404);

  const rows = await db
    .select(mealColumns)
    .from(meals)
    .where(and(eq(meals.partnerId, partner.id), eq(meals.isDeleted, false)))
    .orderBy(asc(meals.sortOrder), asc(meals.name));

  return json({ partnerId: partner.id, currency: partner.currency, meals: rows }, 200);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { mealId } = parsed.data;

  const db = getDb();

  // Scope the lookup by partnerId as well as mealId: a dish id from another
  // restaurant must read as "not here", never as a cross-restaurant edit.
  const [existing] = await db
    .select(mealColumns)
    .from(meals)
    .where(
      and(eq(meals.id, mealId), eq(meals.partnerId, id), eq(meals.isDeleted, false)),
    )
    .limit(1);
  if (!existing) return json({ error: 'meal_not_found' }, 404);

  // Already off the menu: nothing changed, so nothing is audited either. The
  // reply still carries the row so the console lands on the same truth.
  if (!existing.isActive) return json({ meal: existing }, 200);

  const updated = await db
    .update(meals)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(meals.id, mealId), eq(meals.partnerId, id), eq(meals.isActive, true)))
    .returning(mealColumns);

  // Lost the race to whoever unlisted it first — same end state, still no
  // second audit row for a change this request did not make.
  const row = updated[0];
  if (!row) return json({ meal: { ...existing, isActive: false } }, 200);

  await logAudit(
    principal,
    'partner.meal.unlist',
    'meals',
    row.id,
    { partnerId: id, name: row.name },
    clientIp(req),
  );

  return json({ meal: row }, 200);
}
