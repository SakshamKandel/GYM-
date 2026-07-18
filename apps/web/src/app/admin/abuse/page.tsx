import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { AbuseManager } from './_components/AbuseManager';
import { loadAbuseDashboard } from './_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin console — referral/trial abuse dashboard (gap build P2-18). Gated on
 * `subscription.override` (see the API route's doc for why this reuses an
 * existing permission rather than a new key). Linked from the admin nav
 * (admin/layout.tsx NAV_ITEMS) behind the same permission; the page also
 * re-checks server-side, same as every other admin route's fail-safe
 * direct-URL re-check.
 */
export default async function AdminAbusePage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('subscription.override')) redirect('/admin');

  const dashboard = await loadAbuseDashboard();

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Referral & trial abuse"
        subtitle="Referral funnel, trial usage patterns, and a per-account trial reset action."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Referrals" value={dashboard.referrals.total} />
        <StatTile label="Rewarded" value={dashboard.referrals.rewarded} />
        <StatTile label="Trial starts" value={dashboard.trials.total} />
        <StatTile label="Multi-tier trial accounts" value={dashboard.trials.multiTrialAccounts.length} />
      </div>

      {dashboard.limitations.length > 0 ? (
        <div
          className="gt-card"
          style={{
            padding: 14,
            marginBottom: 20,
            fontSize: 13,
            color: 'var(--gt-text-dim)',
            borderColor: 'rgba(224,163,74,0.3)',
          }}
        >
          {dashboard.limitations.map((l) => (
            <div key={l}>⚠ {l}</div>
          ))}
        </div>
      ) : null}

      <AbuseManager dashboard={dashboard} />
    </div>
  );
}
