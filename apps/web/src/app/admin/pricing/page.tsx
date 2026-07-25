import { tierPrices } from '@gym/db';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { loadPaymentSettingsRow, paymentSettingsView } from '@/lib/paymentPayee';
import { staffFromCookie } from '@/lib/staffSession';
import { PayeeEditor } from './_components/PayeeEditor';
import { type PriceCell, PricingGrid } from './_components/PricingGrid';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Pricing' };
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

/**
 * The payee row, or nothing if it can't be read. Kept separate so a payment
 * table that isn't there yet (fresh install, before the schema is pushed)
 * renders an empty payee form instead of taking the price editor down with it.
 */
async function loadPayeeRow(): Promise<Awaited<ReturnType<typeof loadPaymentSettingsRow>>> {
  try {
    return await loadPaymentSettingsRow();
  } catch (err) {
    console.error('payment settings lookup failed:', err);
    return undefined;
  }
}

export default async function AdminPricingPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('pricing.manage')) redirect('/admin');

  const [prices, payeeRow] = await Promise.all([loadPrices(), loadPayeeRow()]);

  return (
    <div style={{ maxWidth: 760 }}>
      <PageHeader
        title="Pricing"
        subtitle="Regional monthly prices. Nepal clears in NPR, everywhere else in USD. The server derives currency from region automatically."
      />

      <PricingGrid prices={prices} />

      <div style={{ marginTop: 32 }}>
        <PageHeader
          title="Payment details"
          subtitle="Where members send money for memberships and meal orders. Anything left blank is not offered to members at all."
        />
        <PayeeEditor
          settings={paymentSettingsView(payeeRow)}
          updatedAt={payeeRow?.updatedAt.toISOString() ?? null}
        />
      </div>
    </div>
  );
}
