'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, TierBadge } from '@/components/console';
import { SkeletonBars } from '../../_components/SkeletonBars';

/**
 * Client owner of the attention queue. Fetches GET /api/coach/attention on
 * mount (same-origin — the httpOnly gt_staff cookie authorizes the staff
 * session) and renders the server's staleness-sorted roster verbatim: the API
 * already orders stalest-first with never-synced clients on top, so this
 * component does NO re-sorting.
 *
 * Each row shows the two staleness signals, the latest check-in body
 * (bodyweight, sleep/energy/soreness, note, week summary) and an inline reply
 * box POSTing /api/coach/check-ins/[id]/reply. A successful reply flips the
 * row to its "Replied" state locally — no refetch needed, the reply itself
 * lives in the coach thread.
 *
 * Thin fetches only: no drizzle, no server imports. Weights are canonical kg
 * on the wire and rendered as kg here (console convention).
 */

interface CheckInSummary {
  sessions: number;
  volumeKg: number;
  prCount: number;
}

interface LatestCheckIn {
  id: string;
  accountId: string;
  date: string;
  bodyweightKg: number | null;
  sleep: number;
  energy: number;
  soreness: number;
  note: string;
  summary: CheckInSummary;
  coachReplyMessageId: string | null;
  createdAt: string;
}

interface AttentionClient {
  id: string;
  displayName: string;
  email: string;
  // Membership identity — server-authoritative effective tier, for the tier
  // shield beside the name. Not gamification; never affects this list's order.
  tier: 'starter' | 'silver' | 'gold' | 'elite';
  lastWorkoutAt: string | null;
  lastCheckInAt: string | null;
  daysSinceWorkout: number | null;
  daysSinceCheckIn: number | null;
  latestCheckIn: LatestCheckIn | null;
  pendingSuggestions: number;
}

const REPLY_MAX_LEN = 2000;

/** "82.5 kg" / "100 kg" — canonical kg, one decimal max, locale-stable. */
function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} kg`;
}

/** Whole-day staleness label; null = the client never produced this signal. */
function daysLabel(days: number | null): string {
  if (days === null) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/** Neutral under a week, warning at 7+, critical at 14+ or never. */
function staleTone(days: number | null): 'neutral' | 'warning' | 'critical' {
  if (days === null || days >= 14) return 'critical';
  if (days >= 7) return 'warning';
  return 'neutral';
}

/** One labeled staleness signal ("Last workout · 12 days ago"). */
function StaleSignal({ label, days }: { label: string; days: number | null }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{label}</span>
      <Badge tone={staleTone(days)}>{daysLabel(days)}</Badge>
    </span>
  );
}

/** "Sleep 4/5" metric — dim label, numeric value. */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{label} </span>
      <span className="gt-numeric" style={{ fontSize: 13 }}>
        {value}
      </span>
    </span>
  );
}

export function AttentionList() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  const [clients, setClients] = useState<AttentionClient[]>([]);

  // Inline reply state — one composer open at a time.
  const [replyFor, setReplyFor] = useState<string | null>(null); // client id
  const [replyBody, setReplyBody] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/coach/attention');
      if (!res.ok) {
        setLoadError(
          res.status === 401
            ? 'Your session expired. Sign in again.'
            : 'Could not load the attention queue. Try again.',
        );
        setState('error');
        return;
      }
      const data = (await res.json()) as { clients: AttentionClient[] };
      setClients(data.clients);
      setState('ready');
    } catch {
      setLoadError('Network error. Check your connection and retry.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openReply(clientId: string) {
    setReplyFor(clientId);
    setReplyBody('');
    setReplyError(null);
  }

  async function sendReply(client: AttentionClient) {
    const checkIn = client.latestCheckIn;
    const trimmed = replyBody.trim();
    if (!checkIn || replyBusy || trimmed.length === 0 || trimmed.length > REPLY_MAX_LEN) return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      const res = await fetch(
        `/api/coach/check-ins/${encodeURIComponent(checkIn.id)}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: trimmed }),
        },
      );
      if (!res.ok) {
        setReplyError(
          res.status === 403
            ? 'You are not assigned to this client.'
            : res.status === 401
              ? 'Your session expired. Sign in again.'
              : 'Could not send the reply. Try again.',
        );
        setReplyBusy(false);
        return;
      }
      const data = (await res.json()) as { message: { id: string } };
      // Flip the row to "Replied" locally; the reply lives in the coach thread.
      setClients((prev) =>
        prev.map((c) =>
          c.id === client.id && c.latestCheckIn
            ? {
                ...c,
                latestCheckIn: {
                  ...c.latestCheckIn,
                  coachReplyMessageId: data.message.id,
                },
              }
            : c,
        ),
      );
      setReplyFor(null);
      setReplyBody('');
      setReplyBusy(false);
    } catch {
      setReplyError('Network error. Check your connection and retry.');
      setReplyBusy(false);
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

  if (clients.length === 0) {
    return (
      <EmptyState
        title="No clients yet"
        description="When an admin assigns clients to you, they will appear here sorted by how long they have been quiet."
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
          {clients.length} {clients.length === 1 ? 'client' : 'clients'}, stalest first
        </span>
        <Button size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {clients.map((client) => {
        const checkIn = client.latestCheckIn;
        const replied = checkIn?.coachReplyMessageId != null;
        const composerOpen = replyFor === client.id;
        const trimmed = replyBody.trim();
        const canSend =
          trimmed.length > 0 && trimmed.length <= REPLY_MAX_LEN && !replyBusy;
        const name = client.displayName || client.email;

        return (
          <div
            key={client.id}
            className="gt-card"
            style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {/* Identity + staleness signals */}
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Link
                    href={`/coach/threads/${client.id}`}
                    style={{
                      fontFamily: 'var(--font-heading)',
                      fontWeight: 600,
                      fontSize: 15,
                      color: 'inherit',
                      textDecoration: 'none',
                    }}
                  >
                    {name}
                  </Link>
                  <TierBadge tier={client.tier} />
                </span>
                <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 2 }}>
                  {client.email}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                }}
              >
                <StaleSignal label="Last workout" days={client.daysSinceWorkout} />
                <StaleSignal label="Last check-in" days={client.daysSinceCheckIn} />
                {client.pendingSuggestions > 0 ? (
                  <Link href="/coach/review" style={{ textDecoration: 'none' }}>
                    <Badge tone="info">
                      {client.pendingSuggestions} to review
                    </Badge>
                  </Link>
                ) : null}
              </div>
            </div>

            {/* Latest check-in body */}
            {checkIn ? (
              <div
                style={{
                  borderTop: '1px solid var(--gt-border)',
                  paddingTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
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
                  <span
                    style={{
                      fontSize: 12,
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                      color: 'var(--gt-text-dim)',
                      fontFamily: 'var(--font-heading)',
                    }}
                  >
                    Latest check-in · <span className="gt-numeric">{checkIn.date}</span>
                  </span>
                  {replied ? <Badge tone="positive">Replied</Badge> : null}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  {checkIn.bodyweightKg != null ? (
                    <Metric label="Bodyweight" value={formatKg(checkIn.bodyweightKg)} />
                  ) : null}
                  <Metric label="Sleep" value={`${checkIn.sleep}/5`} />
                  <Metric label="Energy" value={`${checkIn.energy}/5`} />
                  <Metric label="Soreness" value={`${checkIn.soreness}/5`} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <Metric label="Week" value={`${checkIn.summary.sessions} sessions`} />
                  <Metric
                    label="Volume"
                    value={formatKg(checkIn.summary.volumeKg)}
                  />
                  <Metric
                    label="PRs"
                    value={String(checkIn.summary.prCount)}
                  />
                </div>

                {checkIn.note ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      color: 'var(--gt-text)',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    &ldquo;{checkIn.note}&rdquo;
                  </p>
                ) : null}

                {/* Inline reply — the reply lands in the client's coach thread. */}
                {composerOpen ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea
                      className="gt-input"
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={3}
                      maxLength={REPLY_MAX_LEN}
                      placeholder="Reply to this check-in…  (⌘/Ctrl + Enter to send)"
                      aria-label={`Reply to ${name}'s check-in`}
                      autoFocus
                      style={{
                        resize: 'vertical',
                        minHeight: 64,
                        fontFamily: 'var(--font-heading)',
                        lineHeight: 1.5,
                      }}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          void sendReply(client);
                        }
                      }}
                    />
                    {replyError ? (
                      <div style={{ color: '#ff8178', fontSize: 13 }} role="alert">
                        {replyError}
                      </div>
                    ) : null}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 8,
                      }}
                    >
                      <Button
                        size="sm"
                        onClick={() => setReplyFor(null)}
                        disabled={replyBusy}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void sendReply(client)}
                        disabled={!canSend}
                      >
                        {replyBusy ? 'Sending…' : 'Send reply'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button size="sm" onClick={() => openReply(client.id)}>
                      {replied ? 'Reply again' : 'Reply'}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  borderTop: '1px solid var(--gt-border)',
                  paddingTop: 12,
                  fontSize: 13,
                  color: 'var(--gt-text-dim)',
                }}
              >
                No check-ins yet.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
