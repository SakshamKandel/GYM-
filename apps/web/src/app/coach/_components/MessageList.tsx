'use client';

import { EmptyState } from '@/components/console';

export interface ThreadMessage {
  id: string;
  sender: 'user' | 'coach';
  body: string;
  createdAt: Date;
}

/** Time under each bubble (Oswald numerals). */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Day divider label — "Today" / "Yesterday" / an absolute date. */
function formatDayLabel(date: Date): string {
  const now = new Date();
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 86_400_000;
  const diffDays = Math.round((startOf(now) - startOf(date)) / dayMs);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Hairline centered day divider. */
function DayDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        margin: '4px 0',
      }}
    >
      <span style={{ flex: 1, height: 1, background: 'var(--gt-border)' }} />
      <span
        suppressHydrationWarning
        className="gt-numeric"
        style={{
          fontSize: 11,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-dim)',
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--gt-border)' }} />
    </div>
  );
}

/**
 * The coach_chat history, rendered as a real chat log. Mirrors the mobile
 * MessageBubble semantics: the CLIENT's messages sit on the RIGHT; the coach
 * side sits on the LEFT. A human coach reply (sender='coach') therefore renders
 * identically to Greece's AI replies — exactly how the mobile client treats it.
 * Consecutive same-sender messages tuck together; day dividers break the log.
 */
export function MessageList({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return (
      <EmptyState
        title="No messages yet"
        description="This client hasn't started a conversation. Your first reply will open the thread."
      />
    );
  }

  let lastDay = '';
  let lastSender: string | null = null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {messages.map((m) => {
        const fromUser = m.sender === 'user';
        const thisDay = dayKey(m.createdAt);
        const showDivider = thisDay !== lastDay;
        const grouped = !showDivider && m.sender === lastSender;
        lastDay = thisDay;
        lastSender = m.sender;

        return (
          <div key={m.id}>
            {showDivider ? <DayDivider label={formatDayLabel(m.createdAt)} /> : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: fromUser ? 'flex-end' : 'flex-start',
                marginTop: grouped ? 2 : 10,
              }}
            >
              <div
                style={{
                  maxWidth: '76%',
                  padding: '9px 13px',
                  borderRadius: 14,
                  borderTopRightRadius: fromUser ? (grouped ? 14 : 4) : 14,
                  borderTopLeftRadius: fromUser ? 14 : grouped ? 14 : 4,
                  background: fromUser ? 'var(--gt-card)' : 'var(--gt-bg)',
                  border: '1px solid var(--gt-border)',
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--gt-text)',
                }}
              >
                {m.body}
              </div>
              <span
                suppressHydrationWarning
                className="gt-numeric"
                style={{
                  fontSize: 10.5,
                  color: 'var(--gt-text-dim)',
                  margin: '3px 4px 0',
                }}
              >
                {fromUser ? 'Client' : 'You'} · {formatTime(m.createdAt)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
