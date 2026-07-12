import { accounts, tierPrices, type Db } from '@gym/db';
import { applyDiscount, DEFAULT_TIER_PRICES, resolveRegion } from '@gym/shared';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
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
 * Pricing: reads tier_prices for the resolved region (active rows only),
 * lazily seeding the whole table from DEFAULT_TIER_PRICES on first-ever read
 * (only when the table is completely empty — an admin's edited rows are never
 * touched), and filling any missing tier from the shared defaults so the
 * paywall never renders with a gap.
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

/** Seeds tier_prices from DEFAULT_TIER_PRICES exactly once, only when the
 * table has no rows at all yet. onConflictDoNothing is a belt-and-braces
 * guard against a concurrent first-read race. */
async function ensureTierPricesSeeded(db: Db): Promise<void> {
  const [row] = await db.select({ n: count() }).from(tierPrices);
  if ((row?.n ?? 0) > 0) return;

  await db
    .insert(tierPrices)
    .values(
      DEFAULT_TIER_PRICES.map((p) => ({
        region: p.region,
        tier: p.tier,
        amountMinor: p.amountMinor,
        currency: p.currency,
      })),
    )
    .onConflictDoNothing({ target: [tierPrices.region, tierPrices.tier] });
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

  await ensureTierPricesSeeded(db);

  const priceRows = await db
    .select({
      tier: tierPrices.tier,
      amountMinor: tierPrices.amountMinor,
      currency: tierPrices.currency,
    })
    .from(tierPrices)
    .where(and(eq(tierPrices.region, region), eq(tierPrices.active, true)));

  const byTier = new Map(priceRows.map((r) => [r.tier, r]));
  const defaultsForRegion = DEFAULT_TIER_PRICES.filter((p) => p.region === region);
  const merged = defaultsForRegion.map((d) => byTier.get(d.tier) ?? d);

  const grant = await bestActiveGrant(me.id);

  const tiers = merged.map((p) => {
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

  const currency = merged[0]?.currency ?? (region === 'NP' ? 'NPR' : 'USD');

  return json({ region, currency, tiers, trialDays: TRIAL_DAYS }, 200);
}
