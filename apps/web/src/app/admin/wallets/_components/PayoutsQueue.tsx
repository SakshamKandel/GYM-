'use client';

import { formatMoney } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, TextField, TierChip } from '@/components/console';

export type CoachTier = 'silver' | 'gold' | 'elite';
export type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface PayoutRow {
  id: string;
  coach: { id: string; displayName: string; coachTier: CoachTier };
  currency: string;
  amountMinor: number;
  status: PayoutStatus;
  note: string | null;
  disbursementRef: string | null;
  /** Coach's live balance in the requested currency (pending rows only). */
  balanceMinor: number | null;
  requestedAt: string;
  decidedAt: string | null;
}

interface QueueData {
  pending: PayoutRow[];
  history: PayoutRow[];
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const STATUS_TONE: Record<PayoutStatus, 'neutral' | 'positive' | 'warning'> = {
  pending: 'warning',
  approved: 'positive',
  paid: 'positive',
  rejected: 'neutral',
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
};

/**
 * Admin payout-request queue (plan §3 P1-12). Loads GET /api/admin/payouts on
 * mount, lists PENDING requests (approve needs a disbursement reference; reject
 * frees the coach's one-open-request slot) plus decided history. Approve/reject
 * POST /api/admin/payouts/[id]; on success we reload the queue. A monotonic seq
 * guard keeps a slow reload from clobbering a newer one.
 */
export function PayoutsQueue() {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/payouts', { credentials: 'include' });
      if (mine !== seq.current) return;
      if (!res.ok) {
        setLoadError(
          res.status === 403
            ? 'You are not allowed to review payouts.'
            : 'Could not load the payout queue.',
        );
        setLoading(false);
        return;
      }
      const body = (await res.json()) as QueueData;
      if (mine !== seq.current) return;
      setData({ pending: body.pending ?? [], history: body.history ?? [] });
      setLoading(false);
    } catch {
      if (mine !== seq.current) return;
      setLoadError('Network error.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: PayoutRow, action: 'approve' | 'reject') {
    const disbursementRef = (refs[row.id] ?? '').trim();
    if (action === 'approve' && disbursementRef.length === 0) {
      setRowError((m) => ({ ...m, [row.id]: 'Enter a disbursement reference to approve.' }));
      return;
    }
    setBusyId(row.id);
    setRowError((m) => ({ ...m, [row.id]: '' }));
    try {
      const res = await fetch(`/api/admin/payouts/${encodeURIComponent(row.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(
          action === 'approve' ? { action, disbursementRef } : { action },
        ),
      });
      if (!res.ok) {
        let apiError: string | null = null;
        try {
          const b = (await res.json()) as { error?: unknown };
          apiError = typeof b.error === 'string' ? b.error : null;
        } catch {
          apiError = null;
        }
        setRowError((m) => ({
          ...m,
          [row.id]:
            apiError === 'already_decided'
              ? 'Another admin already decided this request.'
              : apiError === 'insufficient_balance'
                ? 'The coach’s balance no longer covers this payout.'
                : res.status === 403
                  ? 'You are not allowed to review payouts.'
                  : 'Could not record that decision. Try again.',
        }));
        setBusyId(null);
        if (apiError === 'already_decided') await load();
        return;
      }
      setBusyId(null);
      await load();
    } catch {
      setRowError((m) => ({ ...m, [row.id]: 'Network error.' }));
      setBusyId(null);
    }
  }

  if (loading && !data) {
    return <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Loading…</div>;
  }
  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--gt-danger)' }}>{loadError}</div>
        <div>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const pending = data?.pending ?? [];
  const history = data?.history ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
            marginBottom: 12,
          }}
        >
          Pending ({pending.length})
        </div>
        {pending.length === 0 ? (
          <EmptyState
            title="No pending payouts"
            description="Coach payout requests awaiting review will appear here."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.map((row) => {
              const covered = row.balanceMinor == null || row.balanceMinor >= row.amountMinor;
              const busy = busyId === row.id;
              return (
                <div
                  key={row.id}
                  style={{ padding: 14, borderRadius: 10, border: '1px solid var(--gt-border)' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontWeight: 600,
                          fontSize: 14,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        {row.coach.displayName}
                        <TierChip tier={row.coach.coachTier} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                        Requested {DATE_FMT.format(new Date(row.requestedAt))}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="gt-numeric" style={{ fontSize: 18 }}>
                        {formatMoney(row.amountMinor, row.currency)}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: covered ? 'var(--gt-text-dim)' : 'var(--gt-danger)',
                        }}
                      >
                        Balance:{' '}
                        {row.balanceMinor == null
                          ? '—'
                          : formatMoney(row.balanceMinor, row.currency)}
                        {covered ? '' : ' (short)'}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-end',
                      marginTop: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <TextField
                      label="Disbursement reference"
                      placeholder="eSewa / Khalti / bank txn id"
                      value={refs[row.id] ?? ''}
                      onChange={(e) =>
                        setRefs((m) => ({ ...m, [row.id]: e.target.value }))
                      }
                      disabled={busy}
                      maxLength={200}
                      style={{ flex: 1, minWidth: 200 }}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void decide(row, 'approve')}
                    >
                      {busy ? 'Working…' : 'Approve & disburse'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void decide(row, 'reject')}
                    >
                      Reject
                    </Button>
                  </div>

                  {rowError[row.id] ? (
                    <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 8 }}>
                      {rowError[row.id]}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
            marginBottom: 12,
          }}
        >
          History
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>No decided payouts yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((row) => (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--gt-border)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    {row.coach.displayName}
                    <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                  </div>
                  {row.disbursementRef ? (
                    <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      Ref: {row.disbursementRef}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>
                    {row.decidedAt ? DATE_FMT.format(new Date(row.decidedAt)) : '—'}
                  </div>
                </div>
                <span className="gt-numeric" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                  {formatMoney(row.amountMinor, row.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
