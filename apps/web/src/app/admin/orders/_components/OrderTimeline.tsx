'use client';

import type { OrderStatus } from '@gym/shared';
import { useEffect, useState } from 'react';
import { SkeletonBar } from '@/components/console';
import { formatShortDateTime, ORDER_STATUS_LABEL } from '@/lib/format';

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
  partner: 'Restaurant',
  admin: 'Admin',
};

/** Raw DB status → the same words the rest of the console (and the restaurant)
 * uses. Unknown/legacy values fall back to the stored string rather than a
 * blank. */
function statusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status as OrderStatus] ?? status;
}

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
    // Shaped like the entries it becomes, so the drawer doesn't reflow around
    // one grey line and then again around the real list.
    return (
      <div
        role="status"
        aria-label="Loading history"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--gt-border-strong)',
                marginTop: 4,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <SkeletonBar w="60%" h={10} />
              <SkeletonBar w="35%" h={9} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (events.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>No transitions recorded yet.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {events.map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
          {/* A bullet, not a signal: one accent dot per history entry put the
              accent on eight rows of a drawer whose actual primary action is
              the button underneath them. */}
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--gt-text-faint)',
              marginTop: 4,
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--gt-text)' }}>
              {e.fromStatus
                ? `${statusLabel(e.fromStatus)} → ${statusLabel(e.toStatus)}`
                : `Created (${statusLabel(e.toStatus)})`}
              {e.actorRole ? (
                <span style={{ color: 'var(--gt-text-dim)' }}> · {ACTOR_LABEL[e.actorRole] ?? e.actorRole}</span>
              ) : null}
            </div>
            <div style={{ color: 'var(--gt-text-dim)' }}>{formatShortDateTime(e.createdAt)}</div>
            {e.note ? <div style={{ marginTop: 2 }}>{e.note}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
