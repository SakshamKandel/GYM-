import { mealPartners, meals, savedAddresses } from '@gym/db';
import { withinRadiusKm } from '@gym/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
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
 * `deliversTo` is a coverage signal derived from the partner's geo service area
 * (serviceLat/Lng + serviceRadiusKm) against the chosen address's pin:
 *   true  = inside the delivery radius
 *   false = outside it
 *   null  = undeterminable (no addressId, no geocoded pin, or partner has no
 *           service-area geo configured) — a text-only address never resolves.
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
  const { partnerId, items, addressId } = parsed.data;

  const db = getDb();
  const cfg = await loadDeliveryConfig(db);

  const [partner] = await db
    .select({
      id: mealPartners.id,
      serviceLat: mealPartners.serviceLat,
      serviceLng: mealPartners.serviceLng,
      serviceRadiusKm: mealPartners.serviceRadiusKm,
    })
    .from(mealPartners)
    .where(and(eq(mealPartners.id, partnerId), eq(mealPartners.isActive, true)))
    .limit(1);
  if (!partner) return json({ error: 'partner_unavailable' }, 400);

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
  if (mealRows.length !== mealIds.length) return json({ error: 'meal_unavailable' }, 400);
  const mealById = new Map(mealRows.map((m) => [m.id, m]));

  // A partner's menu is single-currency; a mixed cart is a client bug.
  const currencies = new Set(mealRows.map((m) => m.currency));
  if (currencies.size !== 1) return json({ error: 'mixed_currency' }, 400);
  const currency = mealRows[0].currency;

  const lines: PricedLine[] = items.map((i) => ({ priceMinor: mealById.get(i.mealId)!.priceMinor, qty: i.qty }));
  const financials = computeOrderFinancials(lines, cfg);

  // Delivery coverage — geo only, and only when both the partner and the chosen
  // address carry coordinates. Anything short of that is null (undeterminable).
  let deliversTo: boolean | null = null;
  if (addressId) {
    const [address] = await db
      .select({ lat: savedAddresses.lat, lng: savedAddresses.lng })
      .from(savedAddresses)
      .where(
        and(
          eq(savedAddresses.id, addressId),
          eq(savedAddresses.accountId, me.id),
          eq(savedAddresses.isDeleted, false),
        ),
      )
      .limit(1);
    if (!address) return json({ error: 'address_not_found' }, 400);
    if (
      address.lat != null &&
      address.lng != null &&
      partner.serviceLat != null &&
      partner.serviceLng != null &&
      partner.serviceRadiusKm != null
    ) {
      deliversTo = withinRadiusKm(
        { lat: partner.serviceLat, lng: partner.serviceLng },
        partner.serviceRadiusKm,
        { lat: address.lat, lng: address.lng },
      );
    }
  }

  return json(
    {
      subtotalMinor: financials.subtotalMinor,
      deliveryFeeMinor: financials.deliveryFeeMinor,
      smallOrderFeeMinor: financials.smallOrderFeeMinor,
      totalMinor: financials.totalMinor,
      currency,
      deliversTo,
    },
    200,
  );
}
