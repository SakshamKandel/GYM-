'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

/**
 * Shared plumbing for the client-detail read panels (ClientDetail's own tabs
 * plus the Nutrition/Body panels that live in their own files). Extracted so a
 * new panel never re-implements the fetch/error/empty behaviour — every panel
 * reports the same three states in the same words, and a fix to one fixes all.
 *
 * Read-only by design: nothing here writes. The write panels (assign, notes)
 * keep their own local state.
 */

/** GET a coach read route; typed, with a stable error string on failure. */
export function usePanelData<T>(path: string): {
  data: T | null;
  error: string | null;
  loading: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not assigned to this client.'
            : res.status === 401
              ? 'Your session expired. Sign in again.'
              : 'Could not load. Try again.',
        );
        setLoading(false);
        return;
      }
      setData((await res.json()) as T);
      setLoading(false);
    } catch {
      setError('Could not reach us just now. Check your connection and try again.');
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading };
}

export function PanelState({ error, loading }: { error: string | null; loading: boolean }) {
  return (
    <div className="gt-card" style={{ padding: 20, color: 'var(--gt-text-dim)', fontSize: 14 }}>
      {loading ? 'Loading…' : (error ?? 'No data.')}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="gt-card" style={{ padding: 14, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{label}</div>
      <div
        className="gt-numeric"
        style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-heading)', marginTop: 4 }}
      >
        {value}
      </div>
      {hint ? (
        <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 2 }}>{hint}</div>
      ) : null}
    </div>
  );
}

/** Responsive stat row — the same grid every panel's headline numbers use. */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

/** A plain, dim "nothing here yet" card — read panels never show a CTA. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="gt-card" style={{ padding: 20, color: 'var(--gt-text-dim)', fontSize: 14 }}>
      {children}
    </div>
  );
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A logged date, in the reader's locale. A bare `yyyy-mm-dd` is a CALENDAR day,
 * not an instant — `new Date('2026-07-25')` is UTC midnight, so rendering it in
 * a timezone behind UTC would show the day before. Date-only values are
 * therefore formatted in UTC; full timestamps keep local time.
 */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const dateOnly = DATE_ONLY.test(v);
  const d = new Date(dateOnly ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, dateOnly ? { timeZone: 'UTC' } : undefined);
}

/** Short axis label for an ISO yyyy-mm-dd day (read in UTC — dates are dates). */
export function fmtShortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export interface SparkPoint {
  date: string;
  trendKg: number;
}

/**
 * Min/max-scaled trend line. Bodyweight barely moves against a zero-based
 * axis, so this scales to the series' own range (unlike the console ChartCard,
 * which is zero-based and right for counts/money).
 */
export function Sparkline({ points }: { points: SparkPoint[] }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 80;
  const vals = points.map((p) => p.trendKg);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((p.trendKg - min) / range) * h).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Bodyweight trend">
      <path d={path} fill="none" stroke="var(--gt-red)" strokeWidth={2} />
    </svg>
  );
}
