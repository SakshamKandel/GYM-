import { tierPrices } from '@gym/db';
import { TIER_ORDER, type PriceRegion, type Tier } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';

/**
 * Public (unauthenticated) pricing catalog for the marketing site.
 *
 * Same source of truth as GET /api/subscription/catalog — the admin-editable
 * tier_prices table — but read for BOTH regions at once so the pricing UI can
 * offer an instant NPR/USD toggle, and with none of the account-scoped parts
 * (no discounts, no region persistence, no billing mode). An incomplete or
 * unreachable catalog is explicitly unavailable; compiled prices are never
 * presented as live data.
 */

export interface PublicTierPrice {
  tier: Tier;
  amountMinor: number;
}

export interface PublicRegionCatalog {
  currency: string;
  tiers: PublicTierPrice[];
  available: boolean;
}

export type PublicCatalog = Record<PriceRegion, PublicRegionCatalog>;

const REGIONS: PriceRegion[] = ['NP', 'INTL'];

function unavailableRegion(region: PriceRegion): PublicRegionCatalog {
  return {
    currency: region === 'NP' ? 'NPR' : 'USD',
    tiers: [],
    available: false,
  };
}

export function unavailableCatalog(): PublicCatalog {
  return { NP: unavailableRegion('NP'), INTL: unavailableRegion('INTL') };
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

    const catalog = unavailableCatalog();
    for (const region of REGIONS) {
      const byTier = new Map(rows.filter((r) => r.region === region).map((r) => [r.tier, r]));
      const ordered = TIER_ORDER.map((tier) => byTier.get(tier));
      if (ordered.some((row) => row === undefined)) continue;
      const complete = ordered.filter((row): row is NonNullable<typeof row> => row !== undefined);
      const currencies = new Set(complete.map((row) => row.currency));
      if (currencies.size !== 1) continue;
      catalog[region] = {
        currency: complete[0]!.currency,
        tiers: complete.map((row) => ({ tier: row.tier, amountMinor: row.amountMinor })),
        available: true,
      };
    }
    return catalog;
  } catch {
    // Marketing pages must never 500 over pricing — ship the shared defaults.
    return unavailableCatalog();
  }
}
