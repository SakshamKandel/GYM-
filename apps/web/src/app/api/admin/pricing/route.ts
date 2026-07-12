import { tierPrices } from '@gym/db';
import { DEFAULT_TIER_PRICES } from '@gym/shared';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — the regional pricing editor (SCALE-UP-PLAN §1.1 / §4.1).
 * Backs the same `tier_prices` table GET /api/subscription/catalog reads.
 *
 *  - GET → every (region, tier) combination (all 8: 2 regions × 4 tiers),
 *    merging in DEFAULT_TIER_PRICES for any pair not yet written to the DB
 *    (defaults show as `active: true`, matching the catalog route's own
 *    fallback behavior) — so the editor always renders a complete grid.
 *  - PUT {prices:[{region, tier, amountMinor}]} → upserts each (region, tier)
 *    row. `currency` is DERIVED server-side from `region` (NP → NPR,
 *    INTL → USD) — never client-supplied, so a request can't mismatch a
 *    price and currency. `amountMinor` bounded 0..10_000_000. Audited once
 *    for the whole batch.
 *
 * Guarded by requirePermission('pricing.manage'); super_admin/main_admin pass
 * (per SCALE-UP-PLAN §4: pricing is super/main only).
 */

const MAX_AMOUNT_MINOR = 10_000_000;

const priceInputSchema = z.object({
  region: z.enum(['NP', 'INTL']),
  tier: z.enum(['starter', 'silver', 'gold', 'elite']),
  amountMinor: z.number().int().min(0).max(MAX_AMOUNT_MINOR),
});

const putSchema = z.object({
  prices: z.array(priceInputSchema).min(1).max(16),
});

/** Currency is derived from region, never accepted from the client. */
function currencyForRegion(region: 'NP' | 'INTL'): string {
  return region === 'NP' ? 'NPR' : 'USD';
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'pricing.manage');
  if (principal instanceof Response) return principal;

  const rows = await getDb()
    .select({
      region: tierPrices.region,
      tier: tierPrices.tier,
      amountMinor: tierPrices.amountMinor,
      currency: tierPrices.currency,
      active: tierPrices.active,
    })
    .from(tierPrices);

  const byKey = new Map(rows.map((r) => [`${r.region}:${r.tier}`, r]));
  const prices = DEFAULT_TIER_PRICES.map(
    (d) =>
      byKey.get(`${d.region}:${d.tier}`) ?? {
        region: d.region,
        tier: d.tier,
        amountMinor: d.amountMinor,
        currency: d.currency,
        active: true,
      },
  );

  return json({ prices }, 200);
}

export async function PUT(req: Request) {
  const principal = await requirePermission(req, 'pricing.manage');
  if (principal instanceof Response) return principal;

  const parsed = putSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const now = new Date();

  // Small, bounded batch (max 16 rows) — sequential upserts are fine, and the
  // neon-http driver has no multi-statement transaction support anyway (see
  // promoEconomy.ts's grantDiscount comment for the same constraint).
  for (const p of parsed.data.prices) {
    const currency = currencyForRegion(p.region);
    await db
      .insert(tierPrices)
      .values({
        region: p.region,
        tier: p.tier,
        amountMinor: p.amountMinor,
        currency,
        active: true,
        updatedBy: principal.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [tierPrices.region, tierPrices.tier],
        set: {
          amountMinor: p.amountMinor,
          currency,
          updatedBy: principal.id,
          updatedAt: now,
        },
      });
  }

  await logAudit(
    principal,
    'pricing.update',
    'tier_prices',
    null,
    { prices: parsed.data.prices },
    clientIp(req),
  );

  const rows = await db
    .select({
      region: tierPrices.region,
      tier: tierPrices.tier,
      amountMinor: tierPrices.amountMinor,
      currency: tierPrices.currency,
      active: tierPrices.active,
    })
    .from(tierPrices);

  return json({ prices: rows }, 200);
}
