'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, TextField } from '@/components/console';
import { SkeletonBars } from '../../_components/SkeletonBars';

/**
 * Client owner of the progression review queue. Fetches the PENDING
 * suggestions from GET /api/coach/suggestions on mount (same-origin — the
 * httpOnly gt_staff cookie authorizes the staff session), groups them by
 * client, and reviews each through POST /api/coach/suggestions/[id]:
 *
 *  - Approve → {action:'approve'} — one click, row leaves the queue.
 *  - Adjust  → {action:'adjust', weightKg, note?} — inline form pre-filled
 *    with the suggested weight; saving counts as the review.
 *
 * The engine never changes exercise selection, so the coach only ever signs
 * off on load — reps are informational (the target range the suggestion was
 * computed against). Weights are canonical kg on the wire and rendered as kg
 * here (console convention).
 *
 * Thin fetches only: no drizzle, no server imports.
 */

interface SuggestionUser {
  id: string;
  displayName: string;
  email: string;
}

interface Suggestion {
  id: string;
  accountId: string;
  exerciseId: string;
  exerciseName: string;
  sourceWorkoutId: string;
  action: 'increase' | 'hold' | 'deload';
  targetWeightKg: number;
  targetRepsMin: number;
  targetRepsMax: number;
  reason: string;
  status: 'pending' | 'approved' | 'adjusted';
  coachId: string | null;
  adjustedWeightKg: number | null;
  coachNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: SuggestionUser;
}

const ACTION_META: Record<
  Suggestion['action'],
  { label: string; tone: 'positive' | 'neutral' | 'warning' }
> = {
  increase: { label: 'Increase', tone: 'positive' },
  hold: { label: 'Hold', tone: 'neutral' },
  deload: { label: 'Deload', tone: 'warning' },
};

const NOTE_MAX_LEN = 500;

/** "82.5 kg" / "100 kg" — canonical kg, one decimal max, locale-stable. */
function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} kg`;
}

/** "8–12 reps" (or "10 reps" when the range collapses). */
function repsLabel(min: number, max: number): string {
  return min === max ? `${min} reps` : `${min}–${max} reps`;
}

/** Short, locale-stable relative time (mirrors the ClientCard helper). */
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

export function ReviewQueue() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Per-row transient state: which row is mid-review, any row-level error, and
  // the one open adjust form (weight kept as raw text until save).
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  const [adjust, setAdjust] = useState<{ id: string; weight: string; note: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/coach/suggestions?status=pending');
      if (!res.ok) {
        setLoadError(
          res.status === 401
            ? 'Your session expired. Sign in again.'
            : 'Could not load the review queue. Try again.',
        );
        setState('error');
        return;
      }
      const data = (await res.json()) as { suggestions: Suggestion[] };
      setSuggestions(data.suggestions);
      setState('ready');
    } catch {
      setLoadError('Network error. Check your connection and retry.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Group by client, preserving the server's oldest-first order within and
  // across groups (a client's group sits where their oldest suggestion sits).
  const groups = useMemo(() => {
    const byUser = new Map<string, { user: SuggestionUser; items: Suggestion[] }>();
    for (const s of suggestions) {
      const group = byUser.get(s.user.id);
      if (group) group.items.push(s);
      else byUser.set(s.user.id, { user: s.user, items: [s] });
    }
    return [...byUser.values()];
  }, [suggestions]);

  async function review(
    suggestion: Suggestion,
    body: { action: 'approve' } | { action: 'adjust'; weightKg: number; note?: string },
  ) {
    if (busyId) return;
    setBusyId(suggestion.id);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/coach/suggestions/${encodeURIComponent(suggestion.id)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        if (res.status === 404) {
          // Already gone (reviewed elsewhere or withdrawn) — drop it.
          setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
        } else {
          setRowError({
            id: suggestion.id,
            msg:
              res.status === 403
                ? 'You are not assigned to this client.'
                : res.status === 401
                  ? 'Your session expired. Sign in again.'
                  : 'Could not save the review. Try again.',
          });
        }
        setBusyId(null);
        return;
      }
      // Reviewed — it is no longer pending, so it leaves the queue.
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setAdjust((prev) => (prev?.id === suggestion.id ? null : prev));
      setBusyId(null);
    } catch {
      setRowError({
        id: suggestion.id,
        msg: 'Network error. Check your connection and retry.',
      });
      setBusyId(null);
    }
  }

  function openAdjust(suggestion: Suggestion) {
    setRowError(null);
    setAdjust({
      id: suggestion.id,
      weight: String(suggestion.targetWeightKg),
      note: '',
    });
  }

  function saveAdjust(suggestion: Suggestion) {
    if (!adjust || adjust.id !== suggestion.id) return;
    const weightKg = Number.parseFloat(adjust.weight);
    if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 10_000) {
      setRowError({ id: suggestion.id, msg: 'Enter a valid weight in kg.' });
      return;
    }
    const note = adjust.note.trim();
    void review(suggestion, {
      action: 'adjust',
      weightKg,
      ...(note.length > 0 ? { note } : {}),
    });
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

  if (suggestions.length === 0) {
    return (
      <EmptyState
        title="Nothing to review"
        description="New progression suggestions appear here after your clients finish and sync a workout. Come back after their next session."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {suggestions.length} pending, oldest first
        </span>
        <Button size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {groups.map(({ user, items }) => (
        <section key={user.id}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginBottom: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {user.displayName || user.email}
            </span>
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{user.email}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((s) => {
              const meta = ACTION_META[s.action];
              const busy = busyId === s.id;
              const adjustOpen = adjust?.id === s.id;
              const error = rowError?.id === s.id ? rowError.msg : null;

              return (
                <div
                  key={s.id}
                  className="gt-card"
                  style={{
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
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
                          {s.exerciseName}
                        </span>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <span className="gt-numeric" style={{ fontSize: 14 }}>
                          {formatKg(s.targetWeightKg)} × {repsLabel(s.targetRepsMin, s.targetRepsMax)}
                        </span>
                      </div>
                      <p
                        style={{
                          margin: '6px 0 0',
                          fontSize: 13,
                          color: 'var(--gt-text-dim)',
                          lineHeight: 1.5,
                        }}
                      >
                        {s.reason}
                      </p>
                    </div>
                    <span
                      className="gt-numeric"
                      style={{ fontSize: 12, color: 'var(--gt-text-dim)', flexShrink: 0 }}
                    >
                      {relativeTime(s.createdAt)}
                    </span>
                  </div>

                  {error ? (
                    <div style={{ color: '#ff8178', fontSize: 13 }} role="alert">
                      {error}
                    </div>
                  ) : null}

                  {adjustOpen ? (
                    <div
                      style={{
                        borderTop: '1px solid var(--gt-border)',
                        paddingTop: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(120px, 180px) 1fr',
                          gap: 10,
                        }}
                      >
                        <TextField
                          label="New weight (kg)"
                          type="number"
                          inputMode="decimal"
                          step={0.5}
                          min={0}
                          value={adjust.weight}
                          onChange={(e) =>
                            setAdjust((prev) =>
                              prev ? { ...prev, weight: e.target.value } : prev,
                            )
                          }
                        />
                        <TextField
                          label="Note (optional)"
                          maxLength={NOTE_MAX_LEN}
                          placeholder="Why you changed it — the member sees this"
                          value={adjust.note}
                          onChange={(e) =>
                            setAdjust((prev) =>
                              prev ? { ...prev, note: e.target.value } : prev,
                            )
                          }
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: 8,
                        }}
                      >
                        <Button size="sm" onClick={() => setAdjust(null)} disabled={busy}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => saveAdjust(s)}
                          disabled={busy}
                        >
                          {busy ? 'Saving…' : 'Save adjustment'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Button
                        size="sm"
                        onClick={() => void review(s, { action: 'approve' })}
                        disabled={busy}
                        style={{
                          color: '#4cc264',
                          borderColor: 'rgba(63,185,80,0.35)',
                        }}
                      >
                        {busy ? 'Saving…' : 'Approve'}
                      </Button>
                      <Button size="sm" onClick={() => openAdjust(s)} disabled={busy}>
                        Adjust
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
