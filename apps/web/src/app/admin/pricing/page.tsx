import { tierPrices } from '@gym/db';
import { DEFAULT_TIER_PRICES } from '@gym/shared';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import type { StaffRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { type PriceCell, PricingGrid } from './_components/PricingGrid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to edit regional pricing. Mirrors the 'pricing.manage' grant
 * in authz.ts — super_admin + main_admin ONLY, per SCALE-UP-PLAN §4. The
 * layout hides the nav link for anyone else; re-checked here to fail safe.
 */
const CAN_MANAGE: readonly StaffRole[] = ['super_admin', 'main_admin'];

/**
 * Merges the live tier_prices table over DEFAULT_TIER_PRICES so every
 * (region, tier) combo always has a value even before the catalog has been
 * edited or seeded — mirrors the fallback GET /api/subscription/catalog uses.
 */
async function loadPrices(): Promise<PriceCell[]> {
  const db = getDb();
  const rows = await db
    .select({
      region: tierPrices.region,
      tier: tierPrices.tier,
      amountMinor: tierPrices.amountMinor,
      currency: tierPrices.currency,
    })
    .from(tierPrices);

  const merged = new Map<string, PriceCell>();
  for (const d of DEFAULT_TIER_PRICES) {
    merged.set(`${d.region}-${d.tier}`, { ...d });
  }
  for (const r of rows) {
    merged.set(`${r.region}-${r.tier}`, {
      region: r.region as PriceCell['region'],
      tier: r.tier as PriceCell['tier'],
      amountMinor: r.amountMinor,
      currency: r.currency,
    });
  }
  return Array.from(merged.values());
}

export default async function AdminPricingPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  if (!CAN_MANAGE.includes(principal.role)) redirect('/admin');

  const prices = await loadPrices();

  return (
    <div style={{ maxWidth: 760 }}>
      <PageHeader
        title="Pricing"
        subtitle="Regional monthly prices. Nepal clears in NPR, everywhere else in USD — the server derives currency from region automatically."
      />

      <PricingGrid prices={prices} />
    </div>
  );
}
