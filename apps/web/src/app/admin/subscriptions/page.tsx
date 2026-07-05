import { accounts, auditLog } from '@gym/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { Card, CardHeader, StatTile } from '@/components/console';
import type { StaffRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import {
  type MemberRow,
  type Tier,
  SubscriptionsManager,
} from './_components/SubscriptionsManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to override subscription tiers. Mirrors canSubscriptions() in
 * admin/layout.tsx and the 'subscription.override' grant in authz.ts
 * (super_admin + main_admin + member_admin). The layout hides the nav link and guards the
 * subtree, but we re-check here so hitting the URL directly still fails safe —
 * every page re-checks its own role set.
 */
const CAN_OVERRIDE: readonly StaffRole[] = ['super_admin', 'main_admin', 'member_admin'];

const MEMBER_CAP = 200;
const LOG_CAP = 30;

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
  if (!CAN_OVERRIDE.includes(principal.role)) redirect('/admin');

  const [members, changes] = await Promise.all([
    loadMembers(),
    loadTierChanges(),
  ]);

  const byTier: Record<Tier, number> = {
    starter: 0,
    silver: 0,
    gold: 0,
    elite: 0,
  };
  for (const m of members) byTier[m.tier]++;
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
        <StatTile label="Members" value={members.length} />
        <StatTile
          label="Paid tiers"
          value={paid}
          hint="silver · gold · elite"
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
