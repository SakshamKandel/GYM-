'use client';

import { BADGE_CATALOG } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState } from '@/components/console';
import { SkeletonBars } from '../../_components/SkeletonBars';

/**
 * Client owner of the badge verification queue. Fetches GET
 * /api/coach/verifications on mount (same-origin — the httpOnly gt_staff
 * cookie authorizes the staff session) and renders the server's oldest-first
 * queue verbatim: status='logged' strength-club badges for the coach's
 * assigned clients.
 *
 * One-click verify posts {action:'verify'} to
 * POST /api/coach/verifications/[awardId]; a success removes the row locally
 * (it is no longer 'logged') — no refetch needed.
 *
 * Thin fetches only: no drizzle, no server imports. The badge catalog is pure
 * data from @gym/shared, used here only to resolve badgeId -> display name.
 */

interface VerificationItem {
  awardId: string;
  userId: string;
  displayName: string;
  badgeId: string;
  earnedAt: string;
}

const BADGE_NAME: Record<string, string> = Object.fromEntries(
  BADGE_CATALOG.map((b) => [b.id, b.name]),
);

/** Short, locale-stable relative time (mirrors the review queue helper). */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
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

export function VerifyQueue() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState<VerificationItem[]>([]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/coach/verifications');
      if (!res.ok) {
        setLoadError(
          res.status === 401
            ? 'Your session expired. Sign in again.'
            : 'Could not load the verification queue. Try again.',
        );
        setState('error');
        return;
      }
      const data = (await res.json()) as { items: VerificationItem[] };
      setItems(data.items);
      setState('ready');
    } catch {
      setLoadError('Network error. Check your connection and retry.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function verify(item: VerificationItem) {
    if (busyId) return;
    setBusyId(item.awardId);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/coach/verifications/${encodeURIComponent(item.awardId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify' }),
        },
      );
      if (!res.ok) {
        if (res.status === 404) {
          // Already gone (verified elsewhere) — drop it.
          setItems((prev) => prev.filter((i) => i.awardId !== item.awardId));
        } else {
          setRowError({
            id: item.awardId,
            msg:
              res.status === 403
                ? 'You are not assigned to this client.'
                : res.status === 401
                  ? 'Your session expired. Sign in again.'
                  : 'Could not verify this badge. Try again.',
          });
        }
        setBusyId(null);
        return;
      }
      setItems((prev) => prev.filter((i) => i.awardId !== item.awardId));
      setBusyId(null);
    } catch {
      setRowError({ id: item.awardId, msg: 'Network error. Check your connection and retry.' });
      setBusyId(null);
    }
  }

  if (state === 'loading') return <SkeletonBars rows={4} />;

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
        <div style={{ fontSize: 14, color: '#ff8178' }} role="alert">
          {loadError}
        </div>
        <Button size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing to verify"
        description="When a client logs a strength-club badge (bench, squat, deadlift, overhead press or total), it lands here for you to confirm."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {items.length} pending, oldest first
        </span>
        <Button size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {items.map((item) => {
        const busy = busyId === item.awardId;
        const error = rowError?.id === item.awardId ? rowError.msg : null;
        const badgeName = BADGE_NAME[item.badgeId] ?? item.badgeId;

        return (
          <div
            key={item.awardId}
            className="gt-card"
            style={{
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    fontSize: 15,
                  }}
                >
                  {badgeName}
                </span>
                <Badge tone="info">Logged</Badge>
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--gt-text-dim)' }}>
                {item.displayName}
                <span className="gt-numeric" style={{ marginLeft: 8, fontSize: 12 }}>
                  {relativeTime(item.earnedAt)}
                </span>
              </div>
              {error ? (
                <div style={{ color: '#ff8178', fontSize: 13, marginTop: 6 }} role="alert">
                  {error}
                </div>
              ) : null}
            </div>
            <Button
              size="sm"
              onClick={() => void verify(item)}
              disabled={busy}
              style={{ color: '#4cc264', borderColor: 'rgba(63,185,80,0.35)' }}
            >
              {busy ? 'Verifying…' : 'Verify'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
