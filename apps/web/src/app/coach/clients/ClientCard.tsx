import Link from 'next/link';
import { StatusChip, TierBadge } from '@/components/console';

export interface Client {
  userId: string;
  displayName: string;
  email: string;
  tier: 'starter' | 'silver' | 'gold' | 'elite';
  status: 'active' | 'suspended';
  unread: number;
  lastActiveAt: Date | null;
}

/** Short, locale-stable relative time. */
function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/**
 * One assigned client. Whole card links to their client-detail hub (WP-10:
 * data + assign + notes + chat), replacing the old chat-only destination. Shows
 * name + email, the tier shield (identity mark, shown once), a suspended chip
 * when the account is suspended, last-active relative time, and an unread count.
 * Unread cards get a faint red left accent (the one place red is allowed —
 * an active-state signal).
 */
export function ClientCard({ client }: { client: Client }) {
  const hasUnread = client.unread > 0;
  const name = client.displayName || client.email;

  return (
    <Link
      href={`/coach/clients/${client.userId}`}
      className="gt-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        textDecoration: 'none',
        color: 'inherit',
        borderLeft: hasUnread
          ? '3px solid var(--gt-red)'
          : '1px solid var(--gt-border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: '100%',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 15,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </span>
            <TierBadge tier={client.tier} />
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--gt-text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
          >
            {client.email}
          </div>
        </div>
        {hasUnread ? (
          <span
            className="gt-numeric"
            aria-label={`${client.unread} unread`}
            style={{
              flexShrink: 0,
              minWidth: 22,
              height: 22,
              padding: '0 6px',
              borderRadius: 999,
              background: 'var(--gt-red)',
              color: '#fff',
              fontSize: 12,
              lineHeight: '22px',
              textAlign: 'center',
            }}
          >
            {client.unread}
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Tier is already shown once via the TierBadge shield next to the
              name above — it's the identity mark; no second text chip here. */}
          {client.status === 'suspended' ? (
            <StatusChip status="suspended" />
          ) : null}
        </div>
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {client.lastActiveAt ? relativeTime(client.lastActiveAt) : 'No activity'}
        </span>
      </div>
    </Link>
  );
}
