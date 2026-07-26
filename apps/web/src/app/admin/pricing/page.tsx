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

/**
 * Load only persisted prices; missing cells stay blank for an admin to fill.
 * `active` comes with them: it is what every catalog read filters on, so a row
 * that is switched off has to look switched off here rather than showing a
 * normal price nobody can buy.
 */
async function loadPrices(): Promise<PriceCell[]> {
  const db = getDb();
  const rows = await db
    .select({
      region: tierPrices.region,
      tier: tierPrices.tier,
      amountMinor: tierPrices.amountMinor,
      currency: tierPrices.currency,
      active: tierPrices.active,
    })
    .from(tierPrices);

  return rows.map((r) => ({
    region: r.region as PriceCell['region'],
    tier: r.tier as PriceCell['tier'],
    amountMinor: r.amountMinor,
    currency: r.currency,
    active: r.active,
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

      {/* A section of this page, not a second page: one h1 per screen, so a
          screen reader's heading list still describes the document. */}
      <section style={{ marginTop: 40 }} aria-labelledby="payment-details-heading">
        <header style={{ marginBottom: 24 }}>
          <h2
            id="payment-details-heading"
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 'var(--gt-fs-h1)',
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
            }}
          >
            Payment details
          </h2>
          <p
            style={{
              margin: '6px 0 0',
              color: 'var(--gt-text-dim)',
              fontSize: 14,
              maxWidth: '60ch',
            }}
          >
            Where members send money for memberships and meal orders. Anything left blank is not
            offered to members at all.
          </p>
        </header>
        <PayeeEditor
          settings={paymentSettingsView(payeeRow)}
          updatedAt={payeeRow?.updatedAt.toISOString() ?? null}
        />
      </section>
    </div>
  );
}
