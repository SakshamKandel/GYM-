'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Modal } from '@/components/console';
import { AssignPanel } from './AssignPanel';
import { BodyPanel } from './BodyPanel';
import { NotesPanel } from './NotesPanel';
import { NutritionPanel } from './NutritionPanel';
import { fmtDate, PanelState, Sparkline, Stat, StatRow, usePanelData } from './panelKit';

/**
 * The client-detail hub body (Pack K / WP-10). A tabbed, all-client-side view
 * that reads the coach read-layer routes (overview / workouts-log / weight /
 * nutrition / body / prs / check-ins) and hosts the write panels (assign
 * workout+diet, log milestone, private note). Every request is a same-origin
 * fetch — the httpOnly `gt_staff` cookie rides along and each route re-runs
 * requireCoachOwnsUser, so the browser never holds authority. All copy the
 * coach sees is server-masked before it ever leaves the API.
 *
 * The Food and Body tabs live in their own files (NutritionPanel/BodyPanel) —
 * this file was already long, and each renders a whole dashboard of its own.
 * Shared fetch/state/number primitives live in ./panelKit.
 */

type Tab =
  | 'overview'
  | 'training'
  | 'nutrition'
  | 'body'
  | 'weight'
  | 'prs'
  | 'checkins'
  | 'assign'
  | 'notes';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'training', label: 'Training' },
  { key: 'nutrition', label: 'Food' },
  { key: 'body', label: 'Body' },
  { key: 'weight', label: 'Weight' },
  { key: 'prs', label: 'PRs' },
  { key: 'checkins', label: 'Check-ins' },
  { key: 'assign', label: 'Assign' },
  { key: 'notes', label: 'Notes' },
];

export function ClientDetail({
  userId,
  clientName,
}: {
  userId: string;
  /** Used only in the end-coaching confirmation copy; falls back to a generic
   * phrase when the page doesn't pass a name. */
  clientName?: string;
}) {
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
      {tab === 'nutrition' ? <NutritionPanel userId={userId} /> : null}
      {tab === 'body' ? <BodyPanel userId={userId} /> : null}
      {tab === 'weight' ? <WeightPanel userId={userId} /> : null}
      {tab === 'prs' ? <PrsPanel userId={userId} /> : null}
      {tab === 'checkins' ? <CheckinsPanel userId={userId} /> : null}
      {tab === 'assign' ? <AssignPanel userId={userId} /> : null}
      {tab === 'notes' ? <NotesPanel userId={userId} /> : null}

      <EndCoaching userId={userId} clientName={clientName} />
    </div>
  );
}

// --- End coaching ------------------------------------------------------------

/**
 * The one destructive action on this page, at the very bottom — the web twin of
 * the mobile client screen's danger action. DELETE /api/coach/users/[userId]
 * ends the caller's OWN active assignment (rows are ended, never deleted) and
 * is the ONLY path that tells the member their coaching ended, so a desktop
 * coach who "just stops replying" leaves them hanging without it.
 *
 * Two steps: a modal restates the consequence in the mobile wording before
 * anything is sent. On success the coach no longer owns this client, so the
 * page would 404 on a refresh — go back to the roster instead.
 */
function EndCoaching({ userId, clientName }: { userId: string; clientName?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = clientName?.trim() || 'this client';

  async function end() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/coach/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are no longer assigned to this client.'
            : res.status === 401
              ? 'Your session expired. Sign in again.'
              : 'Could not end the coaching. Try again.',
        );
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      router.push('/coach/clients');
      router.refresh();
    } catch {
      setError('Could not reach us just now. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <div
      className="gt-card"
      style={{
        marginTop: 8,
        padding: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14 }}>
          End coaching
        </div>
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 2 }}>
          Takes {who} off your roster and lets them know. They keep everything they have logged.
        </div>
        {error && !open ? (
          <div style={{ fontSize: 13, color: 'var(--gt-danger)', marginTop: 6 }} role="alert">
            {error}
          </div>
        ) : null}
      </div>
      <Button
        variant="danger"
        size="sm"
        disabled={busy}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        End coaching
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="End coaching"
        footer={
          <>
            <Button size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Keep coaching
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void end()}>
              {busy ? 'Ending…' : 'End coaching'}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          End coaching with {who}? They keep their logs; the chat thread closes for you.
        </p>
        {error ? (
          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--gt-danger)' }} role="alert">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  );
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
      <StatRow>
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
      </StatRow>
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
              Flagged as implausible, so excluded from stats.
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
      <StatRow>
        <Stat label="Latest trend" value={`${latest.trendKg} kg`} hint={fmtDate(latest.date)} />
        <Stat label="7-day change" value={`${arrow} ${Math.abs(data.summary.deltaKg)} kg`} />
        <Stat label="Rate" value={`${data.summary.ratePerWeekKg} kg/wk`} />
      </StatRow>
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
