import { tierPrices } from '@gym/db';
import { DEFAULT_TIER_PRICES, type PriceRegion, type Tier } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';

/**
 * Public (unauthenticated) pricing catalog for the marketing site.
 *
 * Same source of truth as GET /api/subscription/catalog — the admin-editable
 * tier_prices table — but read for BOTH regions at once so the pricing UI can
 * offer an instant NPR/USD toggle, and with none of the account-scoped parts
 * (no discounts, no region persistence, no billing mode). Every failure mode
 * (no DATABASE_URL at build time, Neon unreachable, empty table) falls back to
 * DEFAULT_TIER_PRICES so the marketing pages always render complete prices.
 */

export interface PublicTierPrice {
  tier: Tier;
  amountMinor: number;
}

export interface PublicRegionCatalog {
  currency: string;
  tiers: PublicTierPrice[];
}

export type PublicCatalog = Record<PriceRegion, PublicRegionCatalog>;

const REGIONS: PriceRegion[] = ['NP', 'INTL'];

function defaultsFor(region: PriceRegion): PublicRegionCatalog {
  const rows = DEFAULT_TIER_PRICES.filter((p) => p.region === region);
  return {
    currency: rows[0]?.currency ?? (region === 'NP' ? 'NPR' : 'USD'),
    tiers: rows.map((p) => ({ tier: p.tier, amountMinor: p.amountMinor })),
  };
}

export function fallbackCatalog(): PublicCatalog {
  return { NP: defaultsFor('NP'), INTL: defaultsFor('INTL') };
}

export async function loadPublicCatalog(): Promise<PublicCatalog> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        region: tierPrices.region,
        tier: tierPrices.tier,
        amountMinor: tierPrices.amountMinor,
        currency: tierPrices.currency,
      })
      .from(tierPrices)
      .where(eq(tierPrices.active, true));

    const catalog = fallbackCatalog();
    for (const region of REGIONS) {
      const byTier = new Map(rows.filter((r) => r.region === region).map((r) => [r.tier, r]));
      catalog[region] = {
        currency: byTier.values().next().value?.currency ?? catalog[region].currency,
        tiers: catalog[region].tiers.map((fallback) => {
          const live = byTier.get(fallback.tier);
          return live ? { tier: live.tier, amountMinor: live.amountMinor } : fallback;
        }),
      };
    }
    return catalog;
  } catch {
    // Marketing pages must never 500 over pricing — ship the shared defaults.
    return fallbackCatalog();
  }
}
