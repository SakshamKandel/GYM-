'use client';

import { useEffect, useState } from 'react';

/**
 * Admin order-drawer timeline (Pack I-timeline / WP-8). Renders the append-only
 * `meal_order_events` audit trail for one order as a simple who/why/when list:
 * every status transition, the actor role that made it, and (when present) the
 * reason attached to that transition. Fetched on-demand when the drawer opens
 * (`GET /api/admin/orders/[id]/events`) — the oversight list itself stays
 * cheap by not joining the event table for every row.
 */

interface TimelineEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorRole: string | null;
  note: string | null;
  createdAt: string;
}

const ACTOR_LABEL: Record<string, string> = {
  member: 'Member',
  partner: 'Partner',
  admin: 'Admin',
};

const FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function OrderTimeline({ orderId }: { orderId: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(false);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/events`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = (await res.json()) as { events: TimelineEvent[] };
        setEvents(data.events);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (error) {
    return <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Couldn't load history.</div>;
  }
  if (!events) {
    return <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Loading history…</div>;
  }
  if (events.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>No transitions recorded yet.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {events.map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--gt-accent-strong)',
              marginTop: 4,
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--gt-text)' }}>
              {e.fromStatus ? `${e.fromStatus} → ${e.toStatus}` : `Created (${e.toStatus})`}
              {e.actorRole ? (
                <span style={{ color: 'var(--gt-text-dim)' }}> · {ACTOR_LABEL[e.actorRole] ?? e.actorRole}</span>
              ) : null}
            </div>
            <div style={{ color: 'var(--gt-text-dim)' }}>{FMT.format(new Date(e.createdAt))}</div>
            {e.note ? <div style={{ marginTop: 2 }}>{e.note}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
