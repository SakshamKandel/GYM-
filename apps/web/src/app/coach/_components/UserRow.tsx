import Link from 'next/link';
import { TierChip } from '@/components/console';

export interface InboxUser {
  userId: string;
  displayName: string;
  email: string;
  tier: 'starter' | 'silver' | 'gold' | 'elite';
  lastMessagePreview: string | null;
  lastMessageSender: 'user' | 'coach' | null;
  lastMessageAt: Date | null;
  unreadCount: number;
}

/** Short, locale-stable relative time for the inbox (Oswald where rendered). */
function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

/**
 * Neutral unread counter for the inbox. Kept a border chip — the red accent is
 * reserved for the primary action + active nav, so the count itself is the
 * signal (Oswald tabular numerals).
 */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="gt-numeric"
      aria-label={`${count} unread`}
      style={{
        minWidth: 22,
        height: 22,
        padding: '0 7px',
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        lineHeight: 1,
        background: 'var(--gt-bg)',
        border: '1px solid var(--gt-border)',
        color: 'var(--gt-text)',
      }}
    >
      {count}
    </span>
  );
}

/**
 * One assigned user in the inbox. The whole card links to their thread. Shows
 * name, tier chip, last-message preview (prefixed "You:" when the coach sent
 * it), relative time, and an unread badge. Unread rows get a faint left accent
 * and a slightly brighter preview. Server-component friendly.
 */
export function UserRow({ user }: { user: InboxUser }) {
  const hasUnread = user.unreadCount > 0;
  const preview = user.lastMessagePreview
    ? `${user.lastMessageSender === 'coach' ? 'You: ' : ''}${user.lastMessagePreview}`
    : 'No messages yet';

  return (
    <Link
      href={`/coach/threads/${user.userId}`}
      className="gt-card gt-inbox-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        textDecoration: 'none',
        color: 'inherit',
        borderLeft: hasUnread
          ? '3px solid var(--gt-red)'
          : '1px solid var(--gt-border)',
      }}
    >
      {/* Monogram avatar — neutral, no gradient. */}
      <div
        aria-hidden
        style={{
          width: 38,
          height: 38,
          flexShrink: 0,
          borderRadius: 10,
          background: 'var(--gt-bg)',
          border: '1px solid var(--gt-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 15,
          color: 'var(--gt-text-dim)',
        }}
      >
        {(user.displayName || user.email).charAt(0).toUpperCase()}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 3,
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
            {user.displayName || user.email}
          </span>
          <TierChip tier={user.tier} />
        </div>
        <div
          style={{
            fontSize: 13,
            color: hasUnread ? 'var(--gt-text)' : 'var(--gt-text-dim)',
            fontWeight: hasUnread ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {preview}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {user.lastMessageAt ? (
          <span
            className="gt-numeric"
            style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}
          >
            {relativeTime(user.lastMessageAt)}
          </span>
        ) : (
          <span style={{ height: 15 }} />
        )}
        <UnreadBadge count={user.unreadCount} />
      </div>
    </Link>
  );
}
