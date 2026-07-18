import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { loadAnalytics } from './_components/data';
import {
  CoachTable,
  CountrySnapshot,
  DeltaTiles,
  PromoTable,
  RevenueByMonth,
  SectionTitle,
  TierSnapshot,
} from './_components/ui';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Platform analytics (plan §3 item 15, P2). Server-rendered so the first paint
 * has data with no client round-trip; the API twin (GET /api/admin/analytics)
 * shares the same loadAnalytics(). Gated on `analytics.read` (super/main only) —
 * the layout already guards the subtree, but we re-resolve here so a direct hit
 * still fails safe.
 */
export default async function AdminAnalyticsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('analytics.read')) redirect('/admin');

  const data = await loadAnalytics();

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Revenue, promo economy, coach output, and membership mix — net of refunds."
      />

      <DeltaTiles deltas={data.deltas} />

      <section style={{ marginBottom: 24 }}>
        <SectionTitle>Revenue by month</SectionTitle>
        <RevenueByMonth revenueByMonth={data.revenueByMonth} currencies={data.currencies} />
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          alignItems: 'start',
          marginBottom: 24,
        }}
      >
        <TierSnapshot rows={data.tierBreakdown} />
        <CountrySnapshot rows={data.countryBreakdown} />
      </div>

      <section style={{ marginBottom: 24 }}>
        <SectionTitle>Promo performance</SectionTitle>
        <PromoTable rows={data.promoPerformance} />
      </section>

      <section>
        <SectionTitle>Coach performance</SectionTitle>
        <CoachTable rows={data.coachPerformance} />
      </section>
    </div>
  );
}
