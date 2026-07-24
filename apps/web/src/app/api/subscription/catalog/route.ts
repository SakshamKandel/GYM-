import { accounts, tierPrices } from '@gym/db';
import { applyDiscount, resolveRegion, TIER_ORDER } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { billingMode } from '@/lib/billing';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { bestActiveGrant } from '@/lib/promoEconomy';

export const runtime = 'nodejs';

/**
 * GET /api/subscription/catalog?region=XX — regional pricing + this account's
 * best active discount (SCALE-UP-PLAN §4.1).
 *
 * Region resolution: `?region=` hint (raw ISO-3166 alpha-2, e.g. from
 * expo-localization) → stored accounts.country → 'INTL'. resolveRegion()
 * clamps whatever comes out to 'NP' | 'INTL'. When the query param is present
 * and differs from the stored country, accounts.country is updated to the RAW
 * hint (not the clamped bucket) so admin analytics keeps the real country.
 *
 * Pricing: reads active tier_prices for the resolved region and requires a
 * complete, single-currency four-tier catalog. Missing rows return 503 rather
 * than silently inventing prices.
 *
 * Discount: the account's single best active discount_grants row (if any) is
 * applied to every non-zero tier price.
 */

const TRIAL_DAYS = 2;

const querySchema = z.object({
  region: z.string().trim().min(2).max(8).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const rawRegion = new URL(req.url).searchParams.get('region') ?? undefined;
  const parsed = querySchema.safeParse({ region: rawRegion });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();

  const [account] = await db
    .select({ country: accounts.country })
    .from(accounts)
    .where(eq(accounts.id, me.id))
    .limit(1);

  const regionParam = parsed.data.region?.toUpperCase();
  const region = resolveRegion(regionParam ?? account?.country ?? null);

  if (regionParam && regionParam !== account?.country) {
    await db.update(accounts).set({ country: regionParam }).where(eq(accounts.id, me.id));
  }

  const priceRows = await db
    .select({
      tier: tierPrices.tier,
      amountMinor: tierPrices.amountMinor,
      currency: tierPrices.currency,
    })
    .from(tierPrices)
    .where(and(eq(tierPrices.region, region), eq(tierPrices.active, true)));

  const byTier = new Map(priceRows.map((r) => [r.tier, r]));
  const ordered = TIER_ORDER.map((tier) => byTier.get(tier));
  if (ordered.some((row) => row === undefined)) {
    return json({ error: 'catalog_unavailable' }, 503);
  }
  const complete = ordered.filter((row): row is NonNullable<typeof row> => row !== undefined);
  const currencies = new Set(complete.map((row) => row.currency));
  if (currencies.size !== 1) return json({ error: 'catalog_unavailable' }, 503);

  const grant = await bestActiveGrant(me.id);

  const tiers = complete.map((p) => {
    if (p.tier === 'starter' || p.amountMinor === 0 || !grant) {
      return { tier: p.tier, amountMinor: p.amountMinor };
    }
    return {
      tier: p.tier,
      amountMinor: p.amountMinor,
      discountedMinor: applyDiscount(p.amountMinor, grant.pct),
      discountPct: grant.pct,
      discountSource: grant.source,
    };
  });

  const currency = complete[0]!.currency;

  // `billingMode` lets the paywall pre-detect (before any tap) whether a paid
  // tier can be granted by the self-serve POST /api/subscription/tier or must
  // route through the store / manual-payment flow (Pack J honest affordance +
  // B23: no optimistic apply → 402 → revert flicker). In 'live' mode the
  // self-serve endpoint returns 402 for every paid tier, so the client shows an
  // "Available in the app store" affordance (INTL) or the eSewa/Khalti section
  // (NP) instead of a Choose CTA that always fails.
  return json({ region, currency, tiers, trialDays: TRIAL_DAYS, billingMode: billingMode() }, 200);
}
