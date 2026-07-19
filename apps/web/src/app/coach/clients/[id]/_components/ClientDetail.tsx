'use client';

import { useCallback, useEffect, useState } from 'react';
import { AssignPanel } from './AssignPanel';
import { NotesPanel } from './NotesPanel';

/**
 * The client-detail hub body (Pack K / WP-10). A tabbed, all-client-side view
 * that reads the coach read-layer routes (overview / workouts-log / weight /
 * prs / check-ins) and hosts the write panels (assign workout+diet, log
 * milestone, private note). Every request is a same-origin fetch — the httpOnly
 * `gt_staff` cookie rides along and each route re-runs requireCoachOwnsUser, so
 * the browser never holds authority. All copy the coach sees is server-masked
 * before it ever leaves the API.
 */

type Tab = 'overview' | 'training' | 'weight' | 'prs' | 'checkins' | 'assign' | 'notes';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'training', label: 'Training' },
  { key: 'weight', label: 'Weight' },
  { key: 'prs', label: 'PRs' },
  { key: 'checkins', label: 'Check-ins' },
  { key: 'assign', label: 'Assign' },
  { key: 'notes', label: 'Notes' },
];

export function ClientDetail({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <nav
        role="tablist"
        aria-label="Client sections"
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--gt-border)',
          paddingBottom: 2,
        }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '10px 12px',
                minHeight: 44,
                fontSize: 14,
                fontFamily: 'var(--font-heading)',
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--gt-text)' : 'var(--gt-text-dim)',
                borderBottom: active ? '2px solid var(--gt-red)' : '2px solid transparent',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'overview' ? <OverviewPanel userId={userId} /> : null}
      {tab === 'training' ? <TrainingPanel userId={userId} /> : null}
      {tab === 'weight' ? <WeightPanel userId={userId} /> : null}
      {tab === 'prs' ? <PrsPanel userId={userId} /> : null}
      {tab === 'checkins' ? <CheckinsPanel userId={userId} /> : null}
      {tab === 'assign' ? <AssignPanel userId={userId} /> : null}
      {tab === 'notes' ? <NotesPanel userId={userId} /> : null}
    </div>
  );
}

// --- Shared fetch helper + small primitives ----------------------------------

/** GET a coach read route; typed, with a stable error string on failure. */
function usePanelData<T>(path: string): { data: T | null; error: string | null; loading: boolean } {
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
      setError('Network error. Check your connection and retry.');
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading };
}

function PanelState({ error, loading }: { error: string | null; loading: boolean }) {
  return (
    <div className="gt-card" style={{ padding: 20, color: 'var(--gt-text-dim)', fontSize: 14 }}>
      {loading ? 'Loading…' : (error ?? 'No data.')}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

// --- Overview ----------------------------------------------------------------

interface Overview {
  client: { assignedAt: string | null; memberSince: string; country: string | null };
  training: {
    totalSessions: number;
    sessionsLast30: number;
    volumeLast30Kg: number;
    prCount: number;
    lastWorkoutAt: string | null;
  };
  body: {
    latestBodyweightKg: number | null;
    latestBodyweightDate: string | null;
    checkInCount: number;
    lastCheckInDate: string | null;
  };
  engagement: { xpTotal: number; streakWeeks: number; bestStreakWeeks: number };
}

function OverviewPanel({ userId }: { userId: string }) {
  const { data, error, loading } = usePanelData<Overview>(
    `/api/coach/clients/${encodeURIComponent(userId)}/overview`,
  );
  if (!data) return <PanelState error={error} loading={loading} />;
  const { training, body, engagement, client } = data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 10,
        }}
      >
        <Stat label="Sessions (30d)" value={String(training.sessionsLast30)} hint={`${training.totalSessions} all-time`} />
        <Stat label="Volume (30d)" value={`${training.volumeLast30Kg.toLocaleString()} kg`} />
        <Stat label="PRs" value={String(training.prCount)} />
        <Stat
          label="Bodyweight"
          value={body.latestBodyweightKg != null ? `${body.latestBodyweightKg} kg` : '—'}
          hint={body.latestBodyweightDate ? fmtDate(body.latestBodyweightDate) : 'no check-in'}
        />
        <Stat label="Weekly streak" value={`${engagement.streakWeeks}w`} hint={`best ${engagement.bestStreakWeeks}w`} />
        <Stat label="Check-ins" value={String(body.checkInCount)} hint={body.lastCheckInDate ? fmtDate(body.lastCheckInDate) : 'none'} />
      </div>
      <div className="gt-card" style={{ padding: 14, fontSize: 13, color: 'var(--gt-text-dim)' }}>
        <div>Last workout: {fmtDate(training.lastWorkoutAt)}</div>
        <div>Coaching since: {fmtDate(client.assignedAt)}</div>
        <div>Member since: {fmtDate(client.memberSince)}</div>
      </div>
    </div>
  );
}

// --- Training log ------------------------------------------------------------

interface LoggedSet {
  exerciseName: string;
  setNo: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  isPr: boolean;
}
interface LoggedWorkout {
  id: string;
  date: string;
  name: string;
  durationSec: number | null;
  ranked: boolean;
  sets: LoggedSet[];
}
interface WorkoutsLog {
  workouts: LoggedWorkout[];
  hasMore: boolean;
}

function TrainingPanel({ userId }: { userId: string }) {
  const { data, error, loading } = usePanelData<WorkoutsLog>(
    `/api/coach/clients/${encodeURIComponent(userId)}/workouts-log?limit=10`,
  );
  if (!data) return <PanelState error={error} loading={loading} />;
  if (data.workouts.length === 0) {
    return (
      <div className="gt-card" style={{ padding: 20, color: 'var(--gt-text-dim)', fontSize: 14 }}>
        No logged workouts yet.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.workouts.map((w) => (
        <div key={w.id} className="gt-card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{w.name}</strong>
            <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              {fmtDate(w.date)}
            </span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {w.sets.map((s, i) => (
              <div
                key={`${w.id}-${i}`}
                className="gt-numeric"
                style={{ fontSize: 13, display: 'flex', gap: 8, color: 'var(--gt-text-dim)' }}
              >
                <span style={{ flex: 1, color: 'var(--gt-text)' }}>{s.exerciseName}</span>
                <span>
                  {s.weightKg}kg × {s.reps}
                  {s.rpe != null ? ` @${s.rpe}` : ''}
                </span>
                {s.isPr ? <span style={{ color: 'var(--gt-red)' }}>PR</span> : null}
              </div>
            ))}
          </div>
          {!w.ranked ? (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--gt-red)' }}>
              Flagged as implausible — excluded from stats.
            </div>
          ) : null}
        </div>
      ))}
      {data.hasMore ? (
        <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          Showing the 10 most recent sessions.
        </div>
      ) : null}
    </div>
  );
}

// --- Weight trend ------------------------------------------------------------

interface TrendPoint {
  date: string;
  kg: number;
  trendKg: number;
}
interface WeightData {
  points: TrendPoint[];
  summary: { direction: 'up' | 'down' | 'flat'; deltaKg: number; ratePerWeekKg: number };
}

function Sparkline({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 80;
  const vals = points.map((p) => p.trendKg);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((p.trendKg - min) / range) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Bodyweight trend">
      <path d={path} fill="none" stroke="var(--gt-red)" strokeWidth={2} />
    </svg>
  );
}

function WeightPanel({ userId }: { userId: string }) {
  const { data, error, loading } = usePanelData<WeightData>(
    `/api/coach/clients/${encodeURIComponent(userId)}/weight`,
  );
  if (!data) return <PanelState error={error} loading={loading} />;
  if (data.points.length === 0) {
    return (
      <div className="gt-card" style={{ padding: 20, color: 'var(--gt-text-dim)', fontSize: 14 }}>
        No bodyweight check-ins logged yet.
      </div>
    );
  }
  const latest = data.points[data.points.length - 1]!;
  const arrow = data.summary.direction === 'up' ? '▲' : data.summary.direction === 'down' ? '▼' : '→';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        <Stat label="Latest trend" value={`${latest.trendKg} kg`} hint={fmtDate(latest.date)} />
        <Stat label="7-day change" value={`${arrow} ${Math.abs(data.summary.deltaKg)} kg`} />
        <Stat label="Rate" value={`${data.summary.ratePerWeekKg} kg/wk`} />
      </div>
      <div className="gt-card" style={{ padding: 14 }}>
        <Sparkline points={data.points} />
        <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 4 }}>
          EWMA trend line over {data.points.length} check-ins (daily scale noise smoothed).
        </div>
      </div>
    </div>
  );
}

// --- PRs ---------------------------------------------------------------------

interface PrRecord {
  exerciseName: string;
  weightKg: number;
  reps: number;
  e1rm: number;
  loggedAt: string;
}
interface PrData {
  records: PrRecord[];
  totalPrs: number;
}

function PrsPanel({ userId }: { userId: string }) {
  const { data, error, loading } = usePanelData<PrData>(
    `/api/coach/clients/${encodeURIComponent(userId)}/prs`,
  );
  if (!data) return <PanelState error={error} loading={loading} />;
  if (data.records.length === 0) {
    return (
      <div className="gt-card" style={{ padding: 20, color: 'var(--gt-text-dim)', fontSize: 14 }}>
        No personal records logged yet.
      </div>
    );
  }
  return (
    <div className="gt-card" style={{ padding: 0, overflow: 'hidden' }}>
      {data.records.map((r, i) => (
        <div
          key={`${r.exerciseName}-${i}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            padding: '12px 14px',
            borderTop: i === 0 ? 'none' : '1px solid var(--gt-border)',
          }}
        >
          <span style={{ fontSize: 14 }}>{r.exerciseName}</span>
          <span className="gt-numeric" style={{ fontSize: 14, color: 'var(--gt-text-dim)' }}>
            {r.weightKg}kg × {r.reps} · e1RM {r.e1rm}kg
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Check-in history --------------------------------------------------------

interface CheckinRow {
  id: string;
  date: string;
  bodyweightKg: number | null;
  sleep: number;
  energy: number;
  soreness: number;
  note: string;
  replied: boolean;
}
interface CheckinData {
  checkIns: CheckinRow[];
}

function CheckinsPanel({ userId }: { userId: string }) {
  const { data, error, loading } = usePanelData<CheckinData>(
    `/api/coach/check-ins?userId=${encodeURIComponent(userId)}`,
  );
  if (!data) return <PanelState error={error} loading={loading} />;
  if (data.checkIns.length === 0) {
    return (
      <div className="gt-card" style={{ padding: 20, color: 'var(--gt-text-dim)', fontSize: 14 }}>
        No check-ins yet.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.checkIns.map((c) => (
        <div key={c.id} className="gt-card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>{fmtDate(c.date)}</strong>
            <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              {c.bodyweightKg != null ? `${c.bodyweightKg} kg` : ''} {c.replied ? '· replied' : ''}
            </span>
          </div>
          <div className="gt-numeric" style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 4 }}>
            Sleep {c.sleep}/5 · Energy {c.energy}/5 · Soreness {c.soreness}/5
          </div>
          {c.note ? <div style={{ fontSize: 13, marginTop: 6 }}>{c.note}</div> : null}
        </div>
      ))}
    </div>
  );
}
