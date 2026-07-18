import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Card, CardHeader, PageHeader, StatTile, TierChip } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { loadMemberSnapshot } from '@/lib/memberSnapshot';
import { staffFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * Read-only member snapshot page (P2-19). Standalone route so it works
 * whether or not `MemberDrawer.tsx` (owned by a different package) ever
 * grows a "View as member" tab against the same `loadMemberSnapshot` data —
 * reachable directly at /admin/members/[id]/view for any members.read
 * holder. Renders server-side straight from `@/lib/memberSnapshot` (no
 * client fetch round trip needed for a read-only page).
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
        <PageHeader title="Member not found" />
        <Link href="/admin/members" style={{ color: 'var(--gt-text-dim)', fontSize: 14 }}>
          ← Back to members
        </Link>
      </div>
    );
  }

  const { profile, tierHistory = [], activity } = snapshot;
  const isLapsed = profile.tier !== 'starter' && profile.effectiveTier === 'starter';

  return (
    <div style={{ maxWidth: 880 }}>
      <PageHeader
        title={profile.displayName || profile.email}
        subtitle={`Read-only snapshot — ${profile.email}`}
        action={
          <Link href="/admin/members" style={{ color: 'var(--gt-text-dim)', fontSize: 14 }}>
            ← Back to members
          </Link>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile
          label="Tier"
          value={<TierChip tier={profile.effectiveTier as 'starter' | 'silver' | 'gold' | 'elite'} />}
          hint={isLapsed ? `Lapsed (was ${profile.tier})` : undefined}
        />
        <StatTile
          label="Status"
          value={
            <Badge tone={profile.status === 'active' ? 'positive' : 'critical'}>{profile.status}</Badge>
          }
        />
        <StatTile label="Workouts logged" value={activity?.workoutCount ?? 0} />
        <StatTile
          label="Streak"
          value={activity?.streakWeeks ?? 0}
          hint={`Best ${activity?.bestStreakWeeks ?? 0}`}
        />
        <StatTile label="XP total" value={activity?.xpTotal ?? 0} />
      </div>

      <div style={{ display: 'grid', gap: 18 }}>
        <Card padded={false}>
          <CardHeader title="Profile basics" />
          <div style={{ padding: 18, display: 'grid', gap: 10, fontSize: 14 }}>
            <Row label="Account id" value={profile.id} mono />
            <Row label="Email" value={profile.email} />
            <Row label="Joined" value={DATE_FMT.format(new Date(profile.createdAt))} />
            <Row label="Country" value={profile.country ?? '—'} />
            <Row label="Staff role" value={profile.staffRole ?? 'Not staff'} />
            <Row
              label="Tier expires"
              value={profile.tierExpiresAt ? DATE_FMT.format(new Date(profile.tierExpiresAt)) : 'No expiry'}
            />
          </div>
        </Card>

        <Card padded={false}>
          <CardHeader title="Tier / account history" />
          {tierHistory.length === 0 ? (
            <div style={{ padding: 18, color: 'var(--gt-text-dim)', fontSize: 14 }}>
              No tier or status changes on record.
            </div>
          ) : (
            <div style={{ padding: '4px 18px 18px' }}>
              {tierHistory.map((h) => (
                <div
                  key={h.id}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--gt-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span className="gt-numeric" style={{ fontSize: 13, fontWeight: 600 }}>
                      {h.action}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      {DATE_FMT.format(new Date(h.createdAt))}
                    </span>
                  </div>
                  {Object.keys(h.meta ?? {}).length > 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      {Object.entries(h.meta)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(' · ')}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--gt-text-dim)' }}>{label}</span>
      <span className={mono ? 'gt-numeric' : undefined} style={{ textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}
