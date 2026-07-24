import { tierPrices } from '@gym/db';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
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

/** Load only persisted prices; missing cells stay blank for an admin to fill. */
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

  return rows.map((r) => ({
    region: r.region as PriceCell['region'],
    tier: r.tier as PriceCell['tier'],
    amountMinor: r.amountMinor,
    currency: r.currency,
  }));
}

export default async function AdminPricingPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('pricing.manage')) redirect('/admin');

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
