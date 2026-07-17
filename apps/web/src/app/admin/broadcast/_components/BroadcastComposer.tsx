'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  EmptyState,
  Modal,
  TextField,
} from '@/components/console';

/**
 * One row of the broadcast history — derived on the server from `broadcast.send`
 * audit rows (see the page's loadHistory). No separate broadcasts table exists;
 * the audit log IS the record.
 */
export interface BroadcastHistoryRow {
  id: string;
  title: string;
  tier: string | null;
  country: string | null;
  recipients: number | null;
  delivered: number | null;
  sentBy: string | null;
  createdAt: string;
}

interface SendResult {
  recipients: number;
  devices: number;
  delivered: number;
  failed: number;
}

const TIERS = ['starter', 'silver', 'gold', 'elite'] as const;

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * Broadcast composer (gap build P0-4). Compose a push announcement, optionally
 * narrow the audience to one membership tier and/or country, CONFIRM the
 * audience, then fan it out via the guarded POST /api/admin/broadcast. The send
 * is irreversible (it reaches real devices), so the primary button opens a
 * confirmation modal rather than firing immediately. On success we surface the
 * delivered/recipient tally and router.refresh() to pull the new audit-derived
 * history row back from the server.
 */
export function BroadcastComposer({
  initialHistory,
}: {
  initialHistory: BroadcastHistoryRow[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tier, setTier] = useState('');
  const [country, setCountry] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const titleTrimmed = title.trim();
  const bodyTrimmed = body.trim();
  const canCompose = titleTrimmed.length > 0 && bodyTrimmed.length > 0;

  const audienceLabel = describeAudience(tier || null, country.trim() || null);

  function openConfirm() {
    if (!canCompose) {
      setError('A title and a message are both required.');
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: titleTrimmed,
          body: bodyTrimmed,
          tier: tier || undefined,
          country: country.trim() || undefined,
        }),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          code = typeof data.error === 'string' ? data.error : null;
        } catch {
          code = null;
        }
        setError(errorCopy(res.status, code));
        setSending(false);
        return;
      }
      const data = (await res.json()) as Partial<SendResult>;
      setResult({
        recipients: numberOr(data.recipients),
        devices: numberOr(data.devices),
        delivered: numberOr(data.delivered),
        failed: numberOr(data.failed),
      });
      setSending(false);
      setConfirmOpen(false);
      // Sent — clear the composer and pull the fresh history row.
      setTitle('');
      setBody('');
      setTier('');
      setCountry('');
      router.refresh();
    } catch {
      setError('Network error — the broadcast may not have been sent. Check the history below before retrying.');
      setSending(false);
    }
  }

  const columns: Column<BroadcastHistoryRow>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (r) => <span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span>,
    },
    {
      key: 'audience',
      header: 'Audience',
      render: (r) => (
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {describeAudience(r.tier, r.country)}
        </span>
      ),
    },
    {
      key: 'recipients',
      header: 'Members',
      width: 90,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {r.recipients ?? '—'}
        </span>
      ),
    },
    {
      key: 'delivered',
      header: 'Delivered',
      width: 100,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {r.delivered ?? '—'}
        </span>
      ),
    },
    {
      key: 'sentBy',
      header: 'Sent by',
      render: (r) => (
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.sentBy ?? '—'}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'When',
      width: 150,
      render: (r) => (
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {DATE_FMT.format(new Date(r.createdAt))}
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          border: '1px solid var(--gt-border)',
          borderRadius: 14,
          padding: 20,
          background: 'var(--gt-surface)',
        }}
      >
        <TextField
          label="Title"
          placeholder="e.g. New winter program is live"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={sending}
          maxLength={120}
        />

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
            Message
          </span>
          <textarea
            className="gt-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={sending}
            maxLength={500}
            rows={4}
            placeholder="Keep it short — this shows as a push notification."
            style={{ resize: 'vertical', minHeight: 88, fontFamily: 'inherit' }}
          />
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            {bodyTrimmed.length}/500
          </span>
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 180 }}>
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Tier (optional)</span>
            <select
              className="gt-input"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              disabled={sending}
              style={{ cursor: 'pointer' }}
            >
              <option value="">All tiers</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Country (optional)"
            placeholder="2-letter code, e.g. NP"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            disabled={sending}
            maxLength={2}
            style={{ flex: 1, minWidth: 180 }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="primary" disabled={sending || !canCompose} onClick={openConfirm}>
            Send broadcast
          </Button>
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            Audience: {audienceLabel}
          </span>
        </div>

        {error ? <div style={{ color: '#ff8178', fontSize: 13 }}>{error}</div> : null}
        {result ? (
          <div
            style={{
              fontSize: 13,
              color: 'var(--gt-text)',
              border: '1px solid var(--gt-border)',
              borderRadius: 10,
              padding: '10px 12px',
              background: 'var(--gt-surface-2, transparent)',
            }}
          >
            Sent to <strong>{result.recipients}</strong> member
            {result.recipients === 1 ? '' : 's'} ({result.devices} device
            {result.devices === 1 ? '' : 's'}): <strong>{result.delivered}</strong> delivered
            {result.failed > 0 ? `, ${result.failed} failed` : ''}.
          </div>
        ) : null}
      </div>

      <div>
        <h2
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 15,
            margin: '0 0 12px',
            color: 'var(--gt-text)',
          }}
        >
          Recent broadcasts
        </h2>
        {initialHistory.length === 0 ? (
          <EmptyState
            title="No broadcasts yet"
            description="Announcements you send appear here, newest first."
          />
        ) : (
          <DataTable columns={columns} rows={initialHistory} rowKey={(r) => r.id} />
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => (sending ? undefined : setConfirmOpen(false))}
        title="Send this broadcast?"
        width={460}
        footer={
          <>
            <Button variant="ghost" disabled={sending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={sending} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Confirm & send'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--gt-text-dim)', margin: 0 }}>
            This sends a push notification to every device of the matching members. It cannot be
            undone.
          </p>
          <div
            style={{
              border: '1px solid var(--gt-border)',
              borderRadius: 10,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gt-text)' }}>
              {titleTrimmed || '(no title)'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--gt-text)', whiteSpace: 'pre-wrap' }}>
              {bodyTrimmed || '(no message)'}
            </div>
            <div style={{ marginTop: 4 }}>
              <Badge tone="neutral">{audienceLabel}</Badge>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Human audience label from the optional tier/country filters. */
function describeAudience(tier: string | null, country: string | null): string {
  const parts: string[] = [];
  if (tier) parts.push(`${tier.charAt(0).toUpperCase()}${tier.slice(1)} tier`);
  if (country) parts.push(country);
  return parts.length === 0 ? 'All members' : parts.join(' · ');
}

function numberOr(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function errorCopy(status: number, code: string | null): string {
  if (code === 'push_not_configured') {
    return 'Push is not configured on the server (no Firebase credential). No broadcast was sent.';
  }
  if (status === 403) return 'You are not allowed to send broadcasts.';
  if (status === 400 || code === 'invalid') {
    return 'Check the title (1–120 chars) and message (1–500 chars).';
  }
  return 'Could not send the broadcast. Try again.';
}
