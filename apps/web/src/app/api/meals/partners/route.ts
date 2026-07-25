import { mealOrderRatings, mealPartners } from '@gym/db';
import { ratingAggregateFromTotals, shouldDisplayRating } from '@gym/shared';
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { loadPayee } from '@/lib/paymentPayee';

export const runtime = 'nodejs';

/**
 * Member meal-partner discovery (§8). Active partners only; the response is the
 * frozen public shape — no accountId, contact or internal flags leak.
 *
 * Ratings: members have been able to rate a delivered order for a while
 * (POST /api/meals/orders/[id]/rating), but nothing ever READ those rows.
 * Each partner's `rating`/`reviewCount` come back already grouped from the
 * database and are folded with the shared `ratingAggregateFromTotals` — the
 * same pure rounding the gym and coach ratings use, so all three round and
 * count identically. Both keys are ADDITIVE and null until the partner clears
 * `MIN_PUBLIC_RATINGS`, so discovery never shows "5.0 (1)" as social proof and
 * a single member's score can't be inferred from a public card.
 *
 * Payee (ADDITIVE top-level `payee` key, null when unconfigured): where money
 * goes for an eSewa/Khalti order or billing cycle. Checkout used to say
 * "transfer first, then upload the receipt" while naming no wallet, so the
 * instruction could not be followed. It is deliberately NOT per-partner: meal
 * money is collected centrally and paid out through partner_payout_requests.
 * `null` means the wallets are not offered at all.
 */

/** Ratings needed before a partner's star average is shown publicly. */
const MIN_PUBLIC_RATINGS = 3;

interface PartnerRating {
  rating: number | null;
  reviewCount: number | null;
}

const NO_RATING: PartnerRating = { rating: null, reviewCount: null };

/**
 * One grouped aggregate, not one row per rating: discovery used to pull every
 * `meal_order_ratings` row for every listed kitchen and average them in
 * JavaScript, so a busy partner's entire rating history crossed the wire on
 * each browse. `between 1 and 5` is the same out-of-range guard the old
 * client-side fold applied (the column is an integer, so range is the only way
 * a star value can be invalid).
 */
async function loadPartnerRatings(partnerIds: string[]): Promise<Map<string, PartnerRating>> {
  const out = new Map<string, PartnerRating>();
  if (partnerIds.length === 0) return out;

  const rows = await getDb()
    .select({
      partnerId: mealOrderRatings.partnerId,
      reviewCount: sql<number>`count(*)::int`,
      sumStars: sql<number>`coalesce(sum(${mealOrderRatings.stars}), 0)::int`,
    })
    .from(mealOrderRatings)
    .where(
      and(inArray(mealOrderRatings.partnerId, partnerIds), between(mealOrderRatings.stars, 1, 5)),
    )
    .groupBy(mealOrderRatings.partnerId);

  for (const row of rows) {
    const agg = ratingAggregateFromTotals(Number(row.sumStars), Number(row.reviewCount));
    if (!shouldDisplayRating(agg.count, MIN_PUBLIC_RATINGS)) continue;
    out.set(row.partnerId, { rating: agg.average, reviewCount: agg.count });
  }
  return out;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const rows = await getDb()
    .select({
      id: mealPartners.id,
      name: mealPartners.name,
      serviceAreas: mealPartners.serviceAreas,
      // Geo reach (additive): the kitchen origin + delivery radius let clients
      // distance-gate a saved address against a partner (withinRadiusKm). All
      // nullable — a partner that hasn't set a geo origin simply omits them.
      serviceLat: mealPartners.serviceLat,
      serviceLng: mealPartners.serviceLng,
      serviceRadiusKm: mealPartners.serviceRadiusKm,
      acceptsCod: mealPartners.acceptsCod,
      currency: mealPartners.currency,
      // Operational pause (additive): the kitchen has stopped taking orders for
      // now. Independent of `isActive` (admin deactivation, which removes the
      // partner from this list entirely) and of per-meal sold-out. Surfaced so
      // the member sees "Closed right now" while browsing instead of only
      // discovering it when checkout is rejected.
      acceptingOrders: mealPartners.acceptingOrders,
    })
    .from(mealPartners)
    .where(eq(mealPartners.isActive, true))
    .orderBy(asc(mealPartners.name));

  const [ratings, payee] = await Promise.all([
    loadPartnerRatings(rows.map((r) => r.id)),
    loadPayee(),
  ]);
  const partners = rows.map((partner) => ({
    ...partner,
    ...(ratings.get(partner.id) ?? NO_RATING),
  }));

  return json({ partners, payee }, 200);
}
