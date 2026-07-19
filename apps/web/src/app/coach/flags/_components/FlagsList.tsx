'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, ConfirmButton, EmptyState } from '@/components/console';
import { SkeletonBars } from '../../_components/SkeletonBars';

/**
 * Client owner of the coach flags list. Fetches GET /api/coach/flags on mount
 * (same-origin — the httpOnly gt_staff cookie authorizes the staff session)
 * and renders the server's unacked-first ordering verbatim.
 *
 * Each row shows the offending top set (heaviest set in the workout) and a
 * plain-English reason, plus a one-click Acknowledge that POSTs
 * /api/coach/flags/[workoutId] — idempotent, so a repeat click is harmless.
 * A two-step Restore (same route, {action:'restore'}) clears a false positive:
 * it re-ranks the workout so the session counts toward badges/leaderboards/PR
 * credit again — the ONLY path to un-flag a plausibility false positive. Since
 * it grants credit it is guarded behind ConfirmButton, and the row leaves the
 * list on success (a ranked workout is no longer flagged). Copy stays neutral
 * throughout: no accusations, no punishment framing.
 *
 * Thin fetches only: no drizzle, no server imports. Weights are canonical kg
 * on the wire and rendered as kg here (console convention).
 */

interface TopSet {
  exerciseName: string;
  weightKg: number;
  reps: number;
}

interface FlagItem {
  workoutId: string;
  userId: string;
  displayName: string;
  date: string;
  name: string;
  reason: 'absolute_bounds' | 'velocity' | string;
  topSet: TopSet | null;
  acked: boolean;
}

const REASON_LABEL: Record<string, string> = {
  absolute_bounds: 'Outside plausible limits',
  velocity: 'Jumped well past recent bests',
};

const REASON_DETAIL: Record<string, string> = {
  absolute_bounds: 'A logged weight, rep count, or estimated one-rep max fell outside what the plausibility check allows.',
  velocity: 'The estimated one-rep max for a lift came in over 20% above this member’s rolling 90-day best.',
};

/** "82.5 kg" / "100 kg" — canonical kg, one decimal max, locale-stable. */
function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} kg`;
}

export function FlagsList() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState<FlagItem[]>([]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'acknowledge' | 'restore' | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/coach/flags');
      if (!res.ok) {
        setLoadError(
          res.status === 401
            ? 'Your session expired. Sign in again.'
            : 'Could not load the flags list. Try again.',
        );
        setState('error');
        return;
      }
      const data = (await res.json()) as { items: FlagItem[] };
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

  async function acknowledge(item: FlagItem) {
    if (busyId || item.acked) return;
    setBusyId(item.workoutId);
    setBusyAction('acknowledge');
    setRowError(null);
    try {
      const res = await fetch(`/api/coach/flags/${encodeURIComponent(item.workoutId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledge' }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          setItems((prev) => prev.filter((i) => i.workoutId !== item.workoutId));
        } else {
          setRowError({
            id: item.workoutId,
            msg:
              res.status === 403
                ? 'You are not assigned to this client.'
                : res.status === 401
                  ? 'Your session expired. Sign in again.'
                  : 'Could not acknowledge this flag. Try again.',
          });
        }
        setBusyId(null);
        setBusyAction(null);
        return;
      }
      setItems((prev) =>
        prev.map((i) => (i.workoutId === item.workoutId ? { ...i, acked: true } : i)),
      );
      setBusyId(null);
      setBusyAction(null);
    } catch {
      setRowError({ id: item.workoutId, msg: 'Network error. Check your connection and retry.' });
      setBusyId(null);
      setBusyAction(null);
    }
  }

  /**
   * Clear a false-positive flag: re-rank the workout so it counts again. The
   * route is idempotent (an already-ranked workout is a no-op). On success the
   * workout is no longer flagged, so it drops off this list.
   */
  async function restore(item: FlagItem) {
    if (busyId) return;
    setBusyId(item.workoutId);
    setBusyAction('restore');
    setRowError(null);
    try {
      const res = await fetch(`/api/coach/flags/${encodeURIComponent(item.workoutId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          setItems((prev) => prev.filter((i) => i.workoutId !== item.workoutId));
        } else {
          setRowError({
            id: item.workoutId,
            msg:
              res.status === 403
                ? 'You are not assigned to this client.'
                : res.status === 401
                  ? 'Your session expired. Sign in again.'
                  : 'Could not restore this workout. Try again.',
          });
        }
        setBusyId(null);
        setBusyAction(null);
        return;
      }
      // Re-ranked → no longer a flag → leaves the list.
      setItems((prev) => prev.filter((i) => i.workoutId !== item.workoutId));
      setBusyId(null);
      setBusyAction(null);
    } catch {
      setRowError({ id: item.workoutId, msg: 'Network error. Check your connection and retry.' });
      setBusyId(null);
      setBusyAction(null);
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
        title="No flags"
        description="Workouts only land here when a logged weight, rep count, or jump versus recent bests falls outside what the plausibility check allows."
      />
    );
  }

  const unackedCount = items.filter((i) => !i.acked).length;

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
          {items.length} {items.length === 1 ? 'flag' : 'flags'}
          {unackedCount > 0 ? ` · ${unackedCount} unacknowledged` : ''}
        </span>
        <Button size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {items.map((item) => {
        const busy = busyId === item.workoutId;
        const error = rowError?.id === item.workoutId ? rowError.msg : null;
        const reasonLabel = REASON_LABEL[item.reason] ?? item.reason;
        const reasonDetail = REASON_DETAIL[item.reason] ?? null;

        return (
          <div
            key={item.workoutId}
            className="gt-card"
            style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
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
                    {item.name || 'Workout'}
                  </span>
                  <Badge tone="warning">{reasonLabel}</Badge>
                  {item.acked ? <Badge tone="positive">Acknowledged</Badge> : null}
                </div>
                <div style={{ marginTop: 4, fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  {item.displayName}
                  <span className="gt-numeric" style={{ marginLeft: 8 }}>
                    {item.date}
                  </span>
                </div>
              </div>
            </div>

            {item.topSet ? (
              <div
                style={{
                  borderTop: '1px solid var(--gt-border)',
                  paddingTop: 10,
                  fontSize: 13,
                  color: 'var(--gt-text)',
                }}
              >
                <span style={{ color: 'var(--gt-text-dim)' }}>Heaviest set logged: </span>
                <span className="gt-numeric">
                  {item.topSet.exerciseName} — {formatKg(item.topSet.weightKg)} × {item.topSet.reps}{' '}
                  {item.topSet.reps === 1 ? 'rep' : 'reps'}
                </span>
              </div>
            ) : null}

            {reasonDetail ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)', lineHeight: 1.5 }}>
                {reasonDetail}
              </p>
            ) : null}

            {error ? (
              <div style={{ color: '#ff8178', fontSize: 13 }} role="alert">
                {error}
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <ConfirmButton
                size="sm"
                label="Restore"
                confirmLabel="Confirm restore"
                busyLabel="Restoring…"
                busy={busy && busyAction === 'restore'}
                onConfirm={() => void restore(item)}
              />
              <Button
                size="sm"
                onClick={() => void acknowledge(item)}
                disabled={busy || item.acked}
              >
                {busy && busyAction === 'acknowledge'
                  ? 'Saving…'
                  : item.acked
                    ? 'Acknowledged'
                    : 'Acknowledge'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
