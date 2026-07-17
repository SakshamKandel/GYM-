import { accounts, auditLog } from '@gym/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { Card, CardHeader, StatTile } from '@/components/console';
import { getDb } from '@/lib/db';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import {
  type MemberRow,
  type Tier,
  SubscriptionsManager,
} from './_components/SubscriptionsManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEMBER_CAP = 200;
const LOG_CAP = 30;

/**
 * Per-tier member counts computed over the WHOLE table on the EFFECTIVE tier
 * (B8/D2): a paid tier whose expiry has lapsed counts as 'starter', so the tiles
 * never drift upward, and the count spans every account rather than the capped
 * roster slice the table renders.
 */
async function loadTierCounts(): Promise<{ byTier: Record<Tier, number>; total: number }> {
  const db = getDb();
  const res = await db.execute<{ tier: string; n: string }>(sql`
    select
      case
        when tier <> 'starter' and tier_expires_at is not null and tier_expires_at <= now()
          then 'starter'
        else tier
      end as tier,
      count(*)::text as n
    from accounts
    group by 1
  `);
  const byTier: Record<Tier, number> = { starter: 0, silver: 0, gold: 0, elite: 0 };
  let total = 0;
  for (const r of res.rows) {
    const n = Number(r.n);
    total += n;
    if (r.tier in byTier) byTier[r.tier as Tier] = n;
  }
  return { byTier, total };
}

/**
 * Loads the member roster (tier + account status) for the override table. Capped
 * so a large member base can't return an unbounded payload; the client table
 * filters client-side within the cap.
 */
async function loadMembers(): Promise<MemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      status: accounts.status,
      tierStartedAt: accounts.tierStartedAt,
      tierExpiresAt: accounts.tierExpiresAt,
    })
    .from(accounts)
    .orderBy(asc(accounts.email))
    .limit(MEMBER_CAP);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    tier: r.tier as Tier,
    status: r.status,
    // ISO strings (or null) so the client component is a plain serializable prop.
    tierStartedAt:
      r.tierStartedAt instanceof Date
        ? r.tierStartedAt.toISOString()
        : r.tierStartedAt
          ? String(r.tierStartedAt)
          : null,
    tierExpiresAt:
      r.tierExpiresAt instanceof Date
        ? r.tierExpiresAt.toISOString()
        : r.tierExpiresAt
          ? String(r.tierExpiresAt)
          : null,
  }));
}

interface TierChange {
  id: string;
  createdAt: Date;
  tier: string | null;
  reason: string | null;
  actorEmail: string | null;
  targetEmail: string | null;
}

/**
 * Recent tier overrides, newest first. Reads audit_log where
 * action='subscription.override' (written by setAccountTier), and LEFT JOINs the
 * actor account (who) and the target account (whose tier) so the log is
 * human-readable. LEFT JOIN because actorId is SET NULL on account delete and a
 * target account may have been removed — the audit row must survive either way.
 * `tier`/`reason` come out of the jsonb meta blob.
 */
async function loadTierChanges(): Promise<TierChange[]> {
  const db = getDb();
  const actor = alias(accounts, 'actor');
  const target = alias(accounts, 'target');
  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      meta: auditLog.meta,
      actorEmail: actor.email,
      targetEmail: target.email,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.actorId))
    .leftJoin(target, eq(target.id, auditLog.targetId))
    .where(
      and(
        eq(auditLog.action, 'subscription.override'),
        eq(auditLog.targetType, 'account'),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(LOG_CAP);

  return rows.map((r) => {
    const meta = (r.meta ?? {}) as { tier?: unknown; reason?: unknown };
    return {
      id: r.id,
      createdAt: r.createdAt,
      tier: typeof meta.tier === 'string' ? meta.tier : null,
      reason: typeof meta.reason === 'string' ? meta.reason : null,
      actorEmail: r.actorEmail,
      targetEmail: r.targetEmail,
    };
  });
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export default async function AdminSubscriptionsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('subscription.override')) redirect('/admin');

  const [members, changes, tierCounts] = await Promise.all([
    loadMembers(),
    loadTierChanges(),
    loadTierCounts(),
  ]);

  const byTier = tierCounts.byTier;
  const paid = byTier.silver + byTier.gold + byTier.elite;

  return (
    <div style={{ maxWidth: 980 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22 }}>Subscriptions</h1>
        <p
          style={{
            color: 'var(--gt-text-dim)',
            fontSize: 14,
            margin: '4px 0 0',
            maxWidth: '60ch',
          }}
        >
          Override a member&apos;s subscription tier. Changes update the account
          immediately and are recorded in the audit log.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatTile label="Members" value={tierCounts.total} />
        <StatTile
          label="Paid tiers"
          value={paid}
          hint="silver · gold · elite · effective"
        />
        <StatTile label="Gold" value={byTier.gold} />
        <StatTile label="Elite" value={byTier.elite} />
      </div>

      <SubscriptionsManager members={members} />

      <div style={{ marginTop: 28 }}>
        <Card padded={false}>
          <CardHeader title="Recent tier changes" />
          {changes.length === 0 ? (
            <div
              style={{
                padding: '28px 18px',
                textAlign: 'center',
                color: 'var(--gt-text-dim)',
                fontSize: 14,
              }}
            >
              No tier overrides yet. Applied overrides appear here, newest first.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {changes.map((c, i) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 12,
                    padding: '12px 18px',
                    borderTop:
                      i === 0 ? 'none' : '1px solid var(--gt-border)',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    className="gt-numeric"
                    style={{
                      fontSize: 12,
                      color: 'var(--gt-text-dim)',
                      minWidth: 92,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {DATE_FMT.format(c.createdAt)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
                    <span style={{ fontWeight: 600 }}>
                      {c.targetEmail ?? 'a deleted member'}
                    </span>
                    <span style={{ color: 'var(--gt-text-dim)' }}> → </span>
                    <span
                      className="gt-numeric"
                      style={{
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {c.tier ?? '—'}
                    </span>
                    {c.reason ? (
                      <span
                        style={{
                          color: 'var(--gt-text-dim)',
                          fontSize: 13,
                        }}
                      >
                        {' · '}
                        {c.reason}
                      </span>
                    ) : null}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--gt-text-dim)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    by {c.actorEmail ?? 'system'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
