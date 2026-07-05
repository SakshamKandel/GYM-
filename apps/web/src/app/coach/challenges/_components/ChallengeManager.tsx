'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, TextField } from '@/components/console';
import { SkeletonBars } from '../../_components/SkeletonBars';

/**
 * Client owner of the coach's monthly challenge + Coach's pick spotlight.
 * Fetches GET /api/coach/challenges and GET /api/coach/users on mount
 * (same-origin — the httpOnly gt_staff cookie authorizes the staff session).
 *
 *  - No challenge this month  -> a create form (title, target session-days).
 *    POST /api/coach/challenges; a 409 {error:'exists'} means another tab (or
 *    a race) already created one this month, so we just reload.
 *  - Challenge exists         -> title + target, then a per-client progress
 *    list (joined?, days vs target, complete?). Reaching the target is
 *    evaluated server-side (on sync / on this GET) — this page only reflects
 *    state, it never marks anyone complete itself.
 *
 * Coach's pick sits below as its own card: pick ANY assigned client (from
 * GET /api/coach/users) once per calendar month via POST /api/coach/picks.
 * A 409 {error:'already_picked'} means the coach already used this month's
 * pick — surfaced as a plain notice, not an error state.
 *
 * Thin fetches only: no drizzle, no server imports.
 */

interface ChallengeMember {
  userId: string;
  displayName: string;
  joined: boolean;
  days: number;
  complete: boolean;
}

interface Challenge {
  id: string;
  title: string;
  monthKey: string;
  targetDays: number;
  members: ChallengeMember[];
}

interface CoachUser {
  id: string;
  displayName: string;
  email: string;
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/** "July 2026" from a 'yyyy-mm' month key, locale-stable enough for a coach console. */
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${names[m - 1]} ${y}`;
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      style={{
        width: '100%',
        height: 6,
        borderRadius: 999,
        background: 'var(--gt-border)',
        overflow: 'hidden',
      }}
      aria-hidden
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: pct >= 100 ? '#4cc264' : 'var(--gt-red)',
          borderRadius: 999,
          transition: 'width 200ms',
        }}
      />
    </div>
  );
}

export function ChallengeManager() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [users, setUsers] = useState<CoachUser[]>([]);

  // Create-form state.
  const [title, setTitle] = useState('');
  const [targetDays, setTargetDays] = useState('12');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Coach's pick state.
  const [pickUserId, setPickUserId] = useState('');
  const [pickBusy, setPickBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickDone, setPickDone] = useState(false);
  const [alreadyPicked, setAlreadyPicked] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [challengeRes, usersRes] = await Promise.all([
        fetch('/api/coach/challenges'),
        fetch('/api/coach/users'),
      ]);
      if (!challengeRes.ok || !usersRes.ok) {
        const failed = !challengeRes.ok ? challengeRes : usersRes;
        setLoadError(
          failed.status === 401
            ? 'Your session expired. Sign in again.'
            : 'Could not load challenges. Try again.',
        );
        setState('error');
        return;
      }
      const challengeData = (await challengeRes.json()) as { challenge: Challenge | null };
      const usersData = (await usersRes.json()) as { users: CoachUser[] };
      setChallenge(challengeData.challenge);
      setUsers(usersData.users);
      setState('ready');
    } catch {
      setLoadError('Network error. Check your connection and retry.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createChallenge() {
    if (createBusy) return;
    const trimmedTitle = title.trim();
    const target = Number.parseInt(targetDays, 10);
    if (trimmedTitle.length === 0 || trimmedTitle.length > 80) {
      setCreateError('Enter a title up to 80 characters.');
      return;
    }
    if (!Number.isFinite(target) || target < 4 || target > 31) {
      setCreateError('Enter a target between 4 and 31 session-days.');
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/coach/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle, targetDays: target, monthKey: currentMonthKey() }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          // Already created (another tab, or a race) — just reload the real state.
          await load();
        } else {
          setCreateError(
            res.status === 401
              ? 'Your session expired. Sign in again.'
              : 'Could not create the challenge. Try again.',
          );
        }
        setCreateBusy(false);
        return;
      }
      await load();
      setCreateBusy(false);
    } catch {
      setCreateError('Network error. Check your connection and retry.');
      setCreateBusy(false);
    }
  }

  async function awardPick() {
    if (pickBusy || !pickUserId) return;
    setPickBusy(true);
    setPickError(null);
    setAlreadyPicked(false);
    try {
      const res = await fetch('/api/coach/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pickUserId }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setAlreadyPicked(true);
        } else {
          setPickError(
            res.status === 403
              ? 'You are not assigned to this client.'
              : res.status === 401
                ? 'Your session expired. Sign in again.'
                : 'Could not save your pick. Try again.',
          );
        }
        setPickBusy(false);
        return;
      }
      setPickDone(true);
      setPickBusy(false);
    } catch {
      setPickError('Network error. Check your connection and retry.');
      setPickBusy(false);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Monthly challenge */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {challenge ? (
          <div className="gt-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <span
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    fontSize: 16,
                  }}
                >
                  {challenge.title}
                </span>
                <div style={{ marginTop: 4, fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  {monthLabel(challenge.monthKey)} · target{' '}
                  <span className="gt-numeric">{challenge.targetDays}</span> session-days
                </div>
              </div>
              <Button size="sm" onClick={() => void load()}>
                Refresh
              </Button>
            </div>

            {challenge.members.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                No clients are assigned to you yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {challenge.members.map((m) => (
                  <div
                    key={m.userId}
                    style={{
                      borderTop: '1px solid var(--gt-border)',
                      paddingTop: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{m.displayName}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {!m.joined ? (
                          <Badge tone="neutral">Not joined</Badge>
                        ) : m.complete ? (
                          <Badge tone="positive">Complete</Badge>
                        ) : (
                          <span className="gt-numeric" style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                            {m.days} / {challenge.targetDays}
                          </span>
                        )}
                      </div>
                    </div>
                    {m.joined ? <ProgressBar value={m.days} max={challenge.targetDays} /> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="gt-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              No challenge yet for {monthLabel(currentMonthKey())}.
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(200px, 1fr) minmax(120px, 160px)',
                gap: 10,
              }}
            >
              <TextField
                label="Title"
                maxLength={80}
                placeholder="e.g. 12 sessions this month"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <TextField
                label="Target session-days"
                type="number"
                inputMode="numeric"
                min={4}
                max={31}
                value={targetDays}
                onChange={(e) => setTargetDays(e.target.value)}
              />
            </div>
            {createError ? (
              <div style={{ color: '#ff8178', fontSize: 13 }} role="alert">
                {createError}
              </div>
            ) : null}
            <div>
              <Button variant="primary" size="sm" onClick={() => void createChallenge()} disabled={createBusy}>
                {createBusy ? 'Creating…' : 'Create challenge'}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Coach's pick */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          Coach&apos;s pick
        </span>
        {users.length === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Once you have assigned clients, you can spotlight one of them here each month."
          />
        ) : (
          <div className="gt-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)', lineHeight: 1.5 }}>
              Spotlight one assigned client this month. They earn the Coach&apos;s pick badge and a
              notification — one pick per month.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(200px, 1fr) auto',
                gap: 10,
                alignItems: 'end',
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: 'var(--gt-text-dim)',
                    fontFamily: 'var(--font-heading)',
                  }}
                >
                  Member
                </span>
                <select
                  className="gt-input"
                  value={pickUserId}
                  onChange={(e) => {
                    setPickUserId(e.target.value);
                    setPickDone(false);
                    setAlreadyPicked(false);
                    setPickError(null);
                  }}
                >
                  <option value="">Choose a client…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName || u.email}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void awardPick()}
                disabled={pickBusy || !pickUserId || pickDone}
              >
                {pickBusy ? 'Saving…' : pickDone ? 'Picked' : 'Award pick'}
              </Button>
            </div>
            {pickError ? (
              <div style={{ color: '#ff8178', fontSize: 13 }} role="alert">
                {pickError}
              </div>
            ) : null}
            {alreadyPicked ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                You already used this month&apos;s Coach&apos;s pick.
              </div>
            ) : null}
            {pickDone ? <Badge tone="positive">Pick awarded</Badge> : null}
          </div>
        )}
      </section>
    </div>
  );
}
