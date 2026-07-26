import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  StatusChip,
  TierChip,
} from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { formatDate, formatDateTime } from '@/lib/format';
import { loadMemberSnapshot } from '@/lib/memberSnapshot';
import { staffFromCookie } from '@/lib/staffSession';
import { staffRoleLabel } from '@/app/admin/_lib/staffRoleLabel';
import { tierLabel } from '@/app/admin/_lib/tierLabel';
import type { StaffRole } from '@gym/shared';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Member record' };
export const dynamic = 'force-dynamic';

type Tier = 'starter' | 'silver' | 'gold' | 'elite';
const TIERS: readonly string[] = ['starter', 'silver', 'gold', 'elite'];
function asTier(raw: string): Tier {
  return TIERS.includes(raw) ? (raw as Tier) : 'starter';
}

/**
 * `tier_change` / `accountSuspended` → `Tier change` / `Account suspended`.
 * The history below is written by machines and read by people, so nothing on
 * this page prints a stored key at an operator.
 */
function humanise(raw: string): string {
  const spaced = raw
    .replace(/[_.-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  if (spaced === '') return '—';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A meta blob as "Tier: gold · Reason: goodwill", never as raw JSON keys. */
function describeMeta(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${humanise(k)}: ${String(v)}`)
    .join(' · ');
}

/**
 * Read-only member snapshot page (P2-19). Standalone route so it works
 * whether or not `MemberDrawer.tsx` (owned by a different package) ever
 * grows a "View as member" tab against the same `loadMemberSnapshot` data —
 * reachable directly at /admin/members/[id]/view for any members.read
 * holder. Renders server-side straight from `@/lib/memberSnapshot` (no
 * client fetch round trip needed for a read-only page).
 *
 * The page answers "who is this" before "how are they doing": identity and
 * membership sit in one card at the top, the activity numbers underneath, and
 * the account history last.
 */
export default async function MemberViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('members.read')) redirect('/admin');

  const { id } = await params;
  const snapshot = await loadMemberSnapshot(id);

  if (!snapshot.found || !snapshot.profile) {
    return (
      <div style={{ maxWidth: 720 }}>
        <PageHeader title="Member record" />
        <EmptyState
          title="We could not find that member"
          description="The account may have been deleted, or the link may be out of date."
          action={<BackLink />}
        />
      </div>
    );
  }

  const { profile, tierHistory = [], activity } = snapshot;
  const isLapsed = profile.tier !== 'starter' && profile.effectiveTier === 'starter';

  return (
    <div style={{ maxWidth: 880 }}>
      <PageHeader
        title={profile.displayName || profile.email}
        subtitle="A read-only view. Open the member from the directory to make changes."
        action={<BackLink />}
      />

      <Card padded={false} style={{ marginBottom: 18 }}>
        <CardHeader title="Membership" />
        <div style={{ padding: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 16,
            }}
          >
            <TierChip tier={asTier(profile.effectiveTier)} />
            {isLapsed ? <Badge tone="warning">Lapsed</Badge> : null}
            <StatusChip status={profile.status === 'suspended' ? 'suspended' : 'active'} />
            {profile.staffRole ? (
              <Badge tone="info">{staffRoleLabel(profile.staffRole as StaffRole)}</Badge>
            ) : null}
          </div>

          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0, 1fr)',
              gap: '10px 20px',
              margin: 0,
              fontSize: 14,
            }}
          >
            <Fact label="Email" value={profile.email} />
            <Fact
              label="Plan"
              value={
                isLapsed
                  ? `${tierLabel(profile.effectiveTier)}, was ${tierLabel(profile.tier)}`
                  : tierLabel(profile.tier)
              }
            />
            <Fact
              label="Access until"
              value={profile.tierExpiresAt ? formatDate(profile.tierExpiresAt) : 'No end date'}
              numeric={Boolean(profile.tierExpiresAt)}
            />
            <Fact label="Joined" value={formatDate(profile.createdAt)} numeric />
            <Fact label="Country" value={profile.country ?? 'Not set'} />
            <Fact label="Account ID" value={profile.id} numeric />
          </dl>
        </div>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 18,
        }}
      >
        <StatTile label="Workouts logged" value={activity?.workoutCount ?? 0} />
        <StatTile
          label="Week streak"
          value={activity?.streakWeeks ?? 0}
          hint={`Best so far ${activity?.bestStreakWeeks ?? 0}`}
        />
        <StatTile label="Total XP" value={activity?.xpTotal ?? 0} />
      </div>

      <Card padded={false}>
        <CardHeader
          title="Account history"
          action={
            <span className="gt-numeric" style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              {tierHistory.length} {tierHistory.length === 1 ? 'entry' : 'entries'}
            </span>
          }
        />
        {tierHistory.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--gt-text)', fontWeight: 600 }}>
              Nothing has changed yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 4 }}>
              Plan and status changes made by staff show up here.
            </div>
          </div>
        ) : (
          <div style={{ padding: '2px 18px 6px' }}>
            {tierHistory.map((h, i) => (
              <div
                key={h.id}
                style={{
                  padding: '14px 0',
                  borderBottom:
                    i === tierHistory.length - 1 ? 'none' : '1px solid var(--gt-border)',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-heading)',
                      fontWeight: 600,
                      fontSize: 14,
                      color: 'var(--gt-text)',
                    }}
                  >
                    {humanise(h.action)}
                  </div>
                  {Object.keys(h.meta ?? {}).length > 0 ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--gt-text-dim)',
                        marginTop: 3,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {describeMeta(h.meta)}
                    </div>
                  ) : null}
                </div>
                <span
                  className="gt-numeric"
                  style={{
                    fontSize: 13,
                    color: 'var(--gt-text-dim)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {formatDateTime(h.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Back to the directory, with a real target size and a visible hover. */
function BackLink() {
  return (
    <Link
      href="/admin/members"
      className="gt-btn"
      data-variant="ghost"
      data-size="sm"
      style={{ textDecoration: 'none' }}
    >
      Back to members
    </Link>
  );
}

function Fact({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div style={{ display: 'contents' }}>
      <dt style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap' }}>{label}</dt>
      <dd
        className={numeric ? 'gt-numeric' : undefined}
        style={{ margin: 0, textAlign: 'right', overflowWrap: 'anywhere' }}
      >
        {value}
      </dd>
    </div>
  );
}
