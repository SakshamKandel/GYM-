import { mealPartners, meals, savedAddresses } from '@gym/db';
import { validateTipMinor } from '@gym/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { deliveryEligibility, deliveryEligibilityError } from '@/lib/deliveryEligibility';
import { json, preflight, readJson } from '@/lib/http';
import { computeOrderFinancials, loadDeliveryConfig, type PricedLine } from '@/lib/meals';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * POST /api/meals/quote — priced order preview for the member checkout (§8).
 *
 * The server is authoritative for EVERY money field: it re-resolves each meal's
 * price against the partner's live menu and recomputes delivery + small-order
 * fees from `meal_delivery_config` (the same `lib/meals` config + fee logic the
 * order-create route uses). NOTHING is written and no slot/cutoff is enforced —
 * this is a pure preview so the member sees the full fee breakdown before
 * committing. The order-create route re-prices and re-freezes everything again
 * on submit, so a stale quote can never let a client dictate an amount.
 *
 * Delivery eligibility is authoritative here too: bounded geo coverage wins,
 * otherwise configured text service areas are used. Outside and indeterminate
 * addresses fail before a total is shown, matching both create routes. A
 * successful response therefore always carries `deliversTo: true`.
 */

const postSchema = z.object({
  partnerId: z.string().min(1),
  items: z
    .array(z.object({ mealId: z.string().min(1), qty: z.number().int().min(1).max(20) }))
    .min(1)
    .max(20),
  addressId: z.string().min(1).optional(),
  window: z.enum(['lunch', 'dinner']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Optional gratuity preview (Pack D). Server-repriced; folded into totalMinor.
  tipMinor: z.number().int().min(0).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  // Quotes fire on a debounce as the cart/address/window change, so the ceiling
  // is generous but still bounded per-account + per-IP.
  const limited = rateLimit({
    route: 'meals/quote',
    limit: 240,
    windowMs: 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { partnerId, items, addressId, tipMinor } = parsed.data;

  const db = getDb();
  const cfg = await loadDeliveryConfig(db);

  const [partner] = await db
    .select({
      id: mealPartners.id,
      serviceAreas: mealPartners.serviceAreas,
      serviceLat: mealPartners.serviceLat,
      serviceLng: mealPartners.serviceLng,
      serviceRadiusKm: mealPartners.serviceRadiusKm,
    })
    .from(mealPartners)
    .where(
      and(
        eq(mealPartners.id, partnerId),
        eq(mealPartners.isActive, true),
        eq(mealPartners.acceptingOrders, true),
      ),
    )
    .limit(1);
  if (!partner) return json({ error: 'partner_unavailable' }, 400);

  const address = addressId
    ? (
        await db
          .select({
            area: savedAddresses.area,
            lat: savedAddresses.lat,
            lng: savedAddresses.lng,
          })
          .from(savedAddresses)
          .where(
            and(
              eq(savedAddresses.id, addressId),
              eq(savedAddresses.accountId, me.id),
              eq(savedAddresses.isDeleted, false),
            ),
          )
          .limit(1)
      )[0]
    : null;
  if (addressId && !address) return json({ error: 'address_not_found' }, 400);

  const eligibilityError = deliveryEligibilityError(deliveryEligibility(partner, address));
  if (eligibilityError) return json({ error: eligibilityError }, 400);

  // Re-resolve every line against THIS partner's live menu (server-authoritative
  // price + currency). A meal that isn't this partner's, is inactive, or is
  // deleted fails the whole quote — exactly as it would fail the create.
  const mealIds = [...new Set(items.map((i) => i.mealId))];
  const mealRows = await db
    .select({ id: meals.id, priceMinor: meals.priceMinor, currency: meals.currency })
    .from(meals)
    .where(
      and(
        inArray(meals.id, mealIds),
        eq(meals.partnerId, partnerId),
        eq(meals.isActive, true),
        eq(meals.isDeleted, false),
      ),
    );
  const mealById = new Map(mealRows.map((m) => [m.id, m]));
  // B11 per-line failure: a deleted/deactivated meal must name WHICH line failed
  // (never a bare slot message) so the client can show "X unavailable — remove &
  // continue". Look the missing meal up by id (any state) to recover its display
  // name for the interstitial; `null` when the id is entirely unknown.
  const missingId = mealIds.find((id) => !mealById.has(id));
  if (missingId) {
    const [named] = await db
      .select({ name: meals.name })
      .from(meals)
      .where(eq(meals.id, missingId))
      .limit(1);
    return json({ error: 'meal_unavailable', mealId: missingId, mealName: named?.name ?? null }, 422);
  }

  // A partner's menu is single-currency; a mixed cart is a client bug.
  const currencies = new Set(mealRows.map((m) => m.currency));
  if (currencies.size !== 1) return json({ error: 'mixed_currency' }, 400);
  const currency = mealRows[0].currency;

  const lines: PricedLine[] = items.map((i) => ({ priceMinor: mealById.get(i.mealId)!.priceMinor, qty: i.qty }));
  const subtotalForTip = lines.reduce((sum, l) => sum + l.priceMinor * l.qty, 0);
  const tipCheck = validateTipMinor(tipMinor ?? 0, subtotalForTip);
  const financials = computeOrderFinancials(lines, cfg, tipCheck.tipMinor);

  // A successful quote is now guaranteed deliverable by the shared eligibility
  // rule above; create routes run that same rule again before writing.
  return json(
    {
      subtotalMinor: financials.subtotalMinor,
      deliveryFeeMinor: financials.deliveryFeeMinor,
      smallOrderFeeMinor: financials.smallOrderFeeMinor,
      tipMinor: financials.tipMinor,
      totalMinor: financials.totalMinor,
      currency,
      deliversTo: true,
    },
    200,
  );
}
