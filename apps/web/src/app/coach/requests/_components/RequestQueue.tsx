'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, TierChip } from '@/components/console';
import { memberLabel } from '../../_components/memberLabel';
import { SkeletonBars } from '../../_components/SkeletonBars';

/**
 * Client owner of the inbound coaching-request queue — the web twin of the
 * Requests block on the mobile coach index (app/staff/coach/index.tsx).
 *
 * Reads GET /api/coach/requests (same-origin, so the httpOnly gt_staff cookie
 * authorizes the staff session) and renders the server's oldest-first order
 * verbatim: first come, first served. A decision POSTs {action:'accept'|
 * 'decline'} to /api/coach/requests/[id]; on success the row is dropped locally
 * and router.refresh() re-runs the layout so the sidebar's pending badge and
 * (after an accept) the client roster both follow along.
 *
 * Thin fetches only — no drizzle, no server imports. Every guard, the capacity
 * re-check and the member push all live in the route.
 */

type Tier = 'starter' | 'silver' | 'gold' | 'elite';
type Action = 'accept' | 'decline';

interface CoachRequest {
  id: string;
  userId: string;
  displayName: string;
  tier: Tier;
  message: string;
  createdAt: string;
}

/** Display name with a neutral fallback — the console never shows member emails. */
function memberName(row: CoachRequest): string {
  return memberLabel(row.displayName);
}

/** Short, locale-stable relative age (mirrors the verify/review queues). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function RequestQueue() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState<CoachRequest[]>([]);
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  // Explains a row that vanished on us (answered elsewhere, or aged out) — a
  // per-row message would unmount with the row it describes.
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setNotice(null);
    try {
      const res = await fetch('/api/coach/requests', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        setLoadError(
          res.status === 401
            ? 'Your session expired. Sign in again.'
            : res.status === 403
              ? 'You do not have access to coaching requests.'
              : 'Could not load your requests. Try again.',
        );
        setState('error');
        return;
      }
      const data = (await res.json()) as { requests: CoachRequest[] };
      setItems(data.requests);
      setState('ready');
    } catch {
      setLoadError('Could not reach us just now. Check your connection and try again.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: CoachRequest, action: Action) {
    if (busy) return;
    setBusy({ id: item.id, action });
    setRowError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/coach/requests/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (res.status === 404) {
          // Already answered elsewhere, or aged out — drop it either way, and
          // say why at the top since the row itself is about to disappear.
          setItems((prev) => prev.filter((r) => r.id !== item.id));
          setNotice(
            data?.error === 'expired'
              ? `${memberName(item)} waited too long, so that request has closed.`
              : `${memberName(item)}'s request is no longer waiting.`,
          );
          router.refresh();
        } else {
          setRowError({
            id: item.id,
            msg:
              res.status === 409
                ? 'Your roster is full. Raise your capacity on your profile to take on more clients.'
                : res.status === 403
                  ? 'You do not have permission to answer requests.'
                  : res.status === 401
                    ? 'Your session expired. Sign in again.'
                    : 'Could not update this request. Try again.',
          });
        }
        setBusy(null);
        return;
      }

      setItems((prev) => prev.filter((r) => r.id !== item.id));
      setBusy(null);
      // Refreshes the sidebar badge, and the roster after an accept.
      router.refresh();
    } catch {
      setRowError({ id: item.id, msg: 'Could not reach us just now. Check your connection and try again.' });
      setBusy(null);
    }
  }

  if (state === 'loading') return <SkeletonBars rows={3} />;

  if (state === 'error') {
    return (
      <div
        className="gt-card"
        style={{
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, color: 'var(--gt-danger)' }} role="alert">
          {loadError}
        </div>
        <Button size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const noticeBanner = notice ? (
    <div
      className="gt-card"
      style={{ padding: '12px 14px', fontSize: 13, color: 'var(--gt-text-dim)' }}
      role="status"
    >
      {notice}
    </div>
  ) : null;

  if (items.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {noticeBanner}
        <EmptyState
          title="No requests waiting"
          description="When a member asks you to be their coach, their request lands here. Accepting adds them to your clients straight away."
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {noticeBanner}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {items.length} waiting, longest first
        </span>
        <Button size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {items.map((item) => {
        const label = memberName(item);
        const message = item.message.trim();
        const rowBusy = busy?.id === item.id;
        const error = rowError?.id === item.id ? rowError.msg : null;

        return (
          <div key={item.id} className="gt-card" style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {label}
              </span>
              <TierChip tier={item.tier} />
              <span
                className="gt-numeric"
                style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gt-text-dim)' }}
              >
                {relativeTime(item.createdAt)}
              </span>
            </div>

            {message ? (
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5 }}>{message}</p>
            ) : (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--gt-text-dim)' }}>
                No message.
              </p>
            )}

            {error ? (
              <div
                style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 8 }}
                role="alert"
              >
                {error}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                size="sm"
                disabled={rowBusy}
                onClick={() => void decide(item, 'accept')}
              >
                {rowBusy && busy?.action === 'accept' ? 'Accepting…' : 'Accept'}
              </Button>
              <Button
                size="sm"
                disabled={rowBusy}
                onClick={() => void decide(item, 'decline')}
              >
                {rowBusy && busy?.action === 'decline' ? 'Declining…' : 'Decline'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
