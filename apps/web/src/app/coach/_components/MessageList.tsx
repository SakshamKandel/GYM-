'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/console';

export interface ThreadMessage {
  id: string;
  sender: 'user' | 'coach';
  body: string;
  createdAt: Date;
}

/** Poll cadence for inbound client messages while the thread is open. */
const POLL_MS = 10_000;
/** Client-side render ceiling — keeps a very long thread bounded in the DOM. */
const RENDER_CAP = 200;

/** Wire shape of GET /api/coach/threads/[userId] rows (a frozen contract). */
interface WireMessage {
  id: string;
  sender: 'user' | 'coach';
  body: string;
  readByCoach: boolean;
  createdAt: string;
}

/** Union two message lists by id, chronological — server rows always win. */
function mergeById(a: ThreadMessage[], b: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map<string, ThreadMessage>();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort(
    (x, y) => x.createdAt.getTime() - y.createdAt.getTime(),
  );
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
 * The coach_chat history, rendered as a real chat log and kept LIVE. Mirrors
 * the mobile MessageBubble semantics: the CLIENT's messages sit on the RIGHT;
 * the coach side sits on the LEFT. A human coach reply (sender='coach')
 * therefore renders identically to Greece's AI replies — exactly how the mobile
 * client treats it. Consecutive same-sender messages tuck together; day
 * dividers break the log.
 *
 * Live delivery (P0-14): the server render seeds `initialMessages`; this
 * component then polls GET /api/coach/threads/[userId] every POLL_MS so an
 * inbound client message appears without a reload, and calls the explicit
 * POST `.../read` route once the thread is actually open (marking read is a
 * mutation and must not ride on a GET render). Polling pauses while the tab is
 * hidden and refreshes on return. When the coach's own reply lands, ReplyBox
 * triggers a server re-render (router.refresh) which flows a fresh
 * `initialMessages` in — merged here so the reply shows instantly.
 */
export function MessageList({
  userId,
  initialMessages,
}: {
  userId: string;
  initialMessages: ThreadMessage[];
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);

  // Merge fresh server snapshots (from router.refresh after the coach replies)
  // without dropping anything the poll already fetched. A ref-identity guard
  // avoids re-merging the same array on unrelated re-renders.
  const lastSeeded = useRef(initialMessages);
  useEffect(() => {
    if (initialMessages === lastSeeded.current) return;
    lastSeeded.current = initialMessages;
    setMessages((prev) => mergeById(prev, initialMessages));
  }, [initialMessages]);

  const markRead = useCallback(() => {
    void fetch(`/api/coach/threads/${encodeURIComponent(userId)}/read`, {
      method: 'POST',
    }).catch(() => {});
  }, [userId]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/coach/threads/${encodeURIComponent(userId)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: WireMessage[] };
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          body: m.body,
          createdAt: new Date(m.createdAt),
        })),
      );
      // Only write when there's actually an unread inbound row to clear.
      if (data.messages.some((m) => m.sender === 'user' && !m.readByCoach)) {
        markRead();
      }
    } catch {
      // Transient poll failure — keep the last-known thread, retry next tick.
    }
  }, [userId, markRead]);

  // Mark read on open, then poll while the tab is visible.
  useEffect(() => {
    markRead();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [markRead, refresh]);

  const view =
    messages.length > RENDER_CAP ? messages.slice(-RENDER_CAP) : messages;

  if (view.length === 0) {
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
      {view.map((m) => {
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
