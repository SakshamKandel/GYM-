import { redirect } from 'next/navigation';
import {
  Card,
  CardHeader,
  ChartCard,
  DataTable,
  GaugeArc,
  HeatGrid,
  PageHeader,
  StatTile,
  StatusChip,
  TierChip,
  type Column,
} from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import {
  loadOverview,
  type OverviewPerms,
  type RecentActivity,
  type RecentSignup,
} from './_overview/data';
import {
  buildSignupHeatmap,
  buildSignupTrend,
  OpsTiles,
  relativeTime,
  TierBreakdown,
  WEEKDAY_LABELS,
} from './_overview/ui';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin overview dashboard. The layout already guards the /admin subtree, but
 * we re-resolve the principal here so hitting this route directly still fails
 * safe. All reads go through getDb (loadOverview) — no API route, no mutations.
 */

/** Humanizes an audit action key ("subscription.override" → "Subscription override"). */
function actionLabel(action: string): string {
  const cleaned = action.replace(/[._]/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const SIGNUP_COLUMNS: Column<RecentSignup>[] = [
  {
    key: 'member',
    header: 'Member',
    render: (r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 220,
          }}
        >
          {r.displayName || '—'}
        </span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--gt-text-dim)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 220,
          }}
        >
          {r.email}
        </span>
      </div>
    ),
  },
  {
    key: 'tier',
    header: 'Tier',
    render: (r) => <TierChip tier={r.tier} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StatusChip status={r.status} />,
  },
  {
    key: 'joined',
    header: 'Joined',
    align: 'right',
    render: (r) => (
      <span
        className="gt-numeric"
        style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
        title={r.createdAt.toISOString()}
      >
        {relativeTime(r.createdAt)}
      </span>
    ),
  },
];

function ActivityRow({ item, last }: { item: RecentActivity; last: boolean }) {
  return (
    <li
      style={{
        listStyle: 'none',
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '12px 18px',
        borderBottom: last ? 'none' : '1px solid var(--gt-border)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--gt-text)' }}>
          {actionLabel(item.action)}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--gt-text-dim)',
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.actorEmail ?? 'system'} · {item.targetType}
          {item.targetId ? ` · ${item.targetId.slice(0, 8)}` : ''}
        </div>
      </div>
      <span
        className="gt-numeric"
        style={{
          fontSize: 12,
          color: 'var(--gt-text-dim)',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
        title={item.createdAt.toISOString()}
      >
        {relativeTime(item.createdAt)}
      </span>
    </li>
  );
}

export default async function AdminOverviewPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');

  const permissions = await effectivePermissionSet(principal);

  // Every section is gated on the SAME permission the API/routes enforce, so a
  // content_admin or support_admin never sees member PII or the audit feed (A3).
  const perms: OverviewPerms = {
    members: permissions.has('members.read'),
    audit: permissions.has('audit.read'),
    applications: permissions.has('coach.application.review'),
    payments: permissions.has('payments.review'),
    support: permissions.has('support.thread.read'),
  };

  const data = await loadOverview(perms);
  const { membership, recentActivity } = data;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="A live snapshot of the platform — membership, coaching, and content at a glance."
      />

      <OpsTiles ops={data.ops} />

      {membership ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <StatTile
            label="Total members"
            value={membership.totalMembers.toLocaleString()}
            viz={{ kind: 'bars', data: membership.tierBreakdown.map((t) => t.count) }}
          />
          <StatTile
            label="Active coaches"
            value={membership.activeCoaches.toLocaleString()}
            viz={{ kind: 'ring', value: membership.coachCapacityPct }}
            hint={`${Math.round(membership.coachCapacityPct * 100)}% capacity used`}
          />
          <StatTile
            label="Active assignments"
            value={membership.activeAssignments.toLocaleString()}
            hint="coach ↔ member"
            viz={{ kind: 'spark', data: membership.dailySignups28.map((d) => d.count) }}
          />
          <StatTile
            label="Plan videos ready"
            value={membership.readyVideos.toLocaleString()}
            hint="published"
          />
        </div>
      ) : null}

      {membership ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(220px, 1fr)',
            gap: 16,
            alignItems: 'stretch',
            marginBottom: 24,
          }}
        >
          <ChartCard
            title="Signups"
            caption="Last 14 days"
            data={buildSignupTrend(membership.dailySignups28)}
          />
          <Card>
            <CardHeader title="Coach capacity" />
            <div style={{ padding: '8px 4px 4px', display: 'flex', justifyContent: 'center' }}>
              <GaugeArc
                value={membership.coachCapacityPct}
                caption="assignments vs. total capacity"
              />
            </div>
          </Card>
        </div>
      ) : null}

      {membership ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)',
            gap: 16,
            alignItems: 'start',
            marginBottom: 24,
          }}
        >
          <Card padded={false}>
            <CardHeader title="Signups by weekday" />
            <div style={{ padding: 18 }}>
              <HeatGrid
                columns={WEEKDAY_LABELS}
                rows={buildSignupHeatmap(membership.dailySignups28)}
                metricLabel="signups"
              />
            </div>
          </Card>

          <section>
            <h2
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: '0.02em',
                color: 'var(--gt-text)',
                marginBottom: 12,
              }}
            >
              Recent signups
            </h2>
            <DataTable
              columns={SIGNUP_COLUMNS}
              rows={membership.recentSignups}
              rowKey={(r) => r.id}
              empty="No members have signed up yet."
            />
          </section>
        </div>
      ) : null}

      {membership || recentActivity ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
            alignItems: 'start',
            marginBottom: 24,
          }}
        >
          {membership ? <TierBreakdown rows={membership.tierBreakdown} /> : null}

          {recentActivity ? (
            <Card padded={false}>
              <CardHeader title="Recent activity" />
              {recentActivity.length === 0 ? (
                <div
                  style={{
                    padding: '28px 18px',
                    textAlign: 'center',
                    color: 'var(--gt-text-dim)',
                    fontSize: 14,
                  }}
                >
                  No staff actions logged yet.
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {recentActivity.map((item, i) => (
                    <ActivityRow
                      key={item.id}
                      item={item}
                      last={i === recentActivity.length - 1}
                    />
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
