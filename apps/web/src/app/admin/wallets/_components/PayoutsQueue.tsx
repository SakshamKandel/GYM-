'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, TextField, TierChip } from '@/components/console';
import { formatDate, formatMoney } from '@/lib/format';
import { ConfirmDialog } from '../../_components/ConfirmDialog';

export type CoachTier = 'silver' | 'gold' | 'elite';
export type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'paid';
/** Which earner rail the queue is showing — coaches or restaurant partners. */
export type PayoutScope = 'coach' | 'partner';

/**
 * Whoever is owed the money. The API returns a `coach` on the coach rail and a
 * `partner` on the partner rail; both collapse to this one shape so the row
 * renders identically either way (a restaurant name simply sits where a coach
 * display name sits, and the tier chip drops off — partners have no tier).
 */
export interface PayoutEarner {
  id: string;
  label: string;
  coachTier: CoachTier | null;
}

export interface PayoutRow {
  id: string;
  earner: PayoutEarner;
  currency: string;
  amountMinor: number;
  status: PayoutStatus;
  note: string | null;
  disbursementRef: string | null;
  /** Earner's live balance in the requested currency (pending rows only). */
  balanceMinor: number | null;
  requestedAt: string;
  decidedAt: string | null;
}

interface QueueData {
  pending: PayoutRow[];
  history: PayoutRow[];
}

/** The wire row — exactly one of `coach` / `partner` is present per scope. */
interface ApiPayoutRow extends Omit<PayoutRow, 'earner'> {
  coach?: { id: string; displayName: string; coachTier: CoachTier } | null;
  partner?: { id: string; name: string } | null;
}

interface ApiQueueData {
  pending?: ApiPayoutRow[];
  history?: ApiPayoutRow[];
}

const SCOPES: { key: PayoutScope; label: string }[] = [
  { key: 'coach', label: 'Coaches' },
  { key: 'partner', label: 'Restaurants' },
];

/** Collapse the scope-specific earner onto one shape (never throws on a gap). */
function toRow(raw: ApiPayoutRow): PayoutRow {
  const { coach, partner, ...rest } = raw;
  const earner: PayoutEarner = coach
    ? { id: coach.id, label: coach.displayName || coach.id, coachTier: coach.coachTier }
    : partner
      ? { id: partner.id, label: partner.name || partner.id, coachTier: null }
      : { id: raw.id, label: 'Unknown', coachTier: null };
  return { ...rest, earner };
}

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
 * frees the earner's one-open-request slot) plus decided history. Approve/reject
 * POST /api/admin/payouts/[id]; on success we reload the queue. A monotonic seq
 * guard keeps a slow reload from clobbering a newer one.
 *
 * Two earner rails share this surface via `?scope=` (and the matching `scope`
 * in the decision body): coaches and restaurant partners. Partner withdrawal
 * requests used to have no admin surface at all, so partner money could never
 * be approved.
 */
export function PayoutsQueue() {
  const router = useRouter();
  const [scope, setScope] = useState<PayoutScope>('coach');
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // Approving disburses real money and rejecting turns down someone's earnings,
  // so both stop for a confirm that names the earner and the amount.
  const [pendingDecision, setPendingDecision] = useState<{
    row: PayoutRow;
    action: 'approve' | 'reject';
  } | null>(null);

  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/payouts?scope=${scope}`, { credentials: 'include' });
      if (mine !== seq.current) return;
      if (!res.ok) {
        setLoadError(
          res.status === 403
            ? 'You are not allowed to review payouts.'
            : 'Could not load payout requests. Try again.',
        );
        setLoading(false);
        return;
      }
      const body = (await res.json()) as ApiQueueData;
      if (mine !== seq.current) return;
      setData({
        pending: (body.pending ?? []).map(toRow),
        history: (body.history ?? []).map(toRow),
      });
      setLoading(false);
    } catch {
      if (mine !== seq.current) return;
      setLoadError('Could not reach us just now. Check your connection and try again.');
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Switching rails drops the other rail's rows and its per-row draft state. */
  function switchScope(next: PayoutScope) {
    // Never swap rails mid-decision — the in-flight POST carries the old scope.
    if (next === scope || busyId !== null) return;
    seq.current += 1; // an in-flight load for the old scope must not land
    setScope(next);
    setData(null);
    setRefs({});
    setRowError({});
    setLoadError(null);
    setLoading(true);
  }

  /**
   * Gate before the confirm: an approve with no disbursement reference is
   * rejected by the server anyway, so catch it here rather than putting a
   * dialog in front of a decision that can't go through.
   */
  function requestDecision(row: PayoutRow, action: 'approve' | 'reject') {
    if (action === 'approve' && (refs[row.id] ?? '').trim().length === 0) {
      setRowError((m) => ({ ...m, [row.id]: 'Add the payment reference before you mark this paid.' }));
      return;
    }
    setRowError((m) => ({ ...m, [row.id]: '' }));
    setPendingDecision({ row, action });
  }

  async function decide(row: PayoutRow, action: 'approve' | 'reject') {
    const disbursementRef = (refs[row.id] ?? '').trim();
    if (action === 'approve' && disbursementRef.length === 0) {
      setRowError((m) => ({ ...m, [row.id]: 'Add the payment reference before you mark this paid.' }));
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
          action === 'approve' ? { action, scope, disbursementRef } : { action, scope },
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
                ? scope === 'partner'
                  ? 'The restaurant’s balance no longer covers this payout.'
                  : 'The coach’s balance no longer covers this payout.'
                : res.status === 403
                  ? 'You are not allowed to review payouts.'
                  : 'Nothing was recorded. Try again.',
        }));
        setBusyId(null);
        if (apiError === 'already_decided') {
          await load();
          // A payout approval by another admin already moved the coach's
          // balance; refresh the server-rendered roster/StatTiles so they
          // don't show the pre-decision figure (P1-6).
          router.refresh();
        }
        return;
      }
      setBusyId(null);
      await load();
      // An approve records a negative ledger entry (balance change) and a reject
      // frees the coach's open-request slot; both invalidate the server-rendered
      // wallet roster balances + top-of-page StatTiles, which only re-derive on a
      // router.refresh() (P1-6).
      router.refresh();
    } catch {
      setRowError((m) => ({
        ...m,
        [row.id]: 'Could not reach us just now, so nothing was recorded.',
      }));
      setBusyId(null);
    }
  }

  // The rail toggle stays mounted through loading and error states — otherwise
  // a failing partner queue would strand the admin with no way back to coaches.
  const scopeTabs = (
    <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Payout earner type">
      {SCOPES.map((s) => {
        const active = scope === s.key;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            onClick={() => switchScope(s.key)}
            style={{
              padding: '7px 14px',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'var(--font-heading)',
              fontSize: 13,
              fontWeight: 600,
              background: active ? 'var(--gt-accent-strong)' : 'transparent',
              color: active ? 'var(--gt-accent-ink)' : 'var(--gt-text)',
              border: active
                ? '1px solid var(--gt-accent-strong)'
                : '1px solid var(--gt-border)',
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {scopeTabs}
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Loading…</div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {scopeTabs}
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
      {scopeTabs}
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
            description={
              scope === 'partner'
                ? 'When a restaurant asks to be paid, the request shows up here.'
                : 'When a coach asks to be paid, the request shows up here.'
            }
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
                        {row.earner.label}
                        {row.earner.coachTier ? <TierChip tier={row.earner.coachTier} /> : null}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                        Requested {formatDate(row.requestedAt)}
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
                      label="Payment reference"
                      placeholder="eSewa, Khalti or bank reference number"
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
                      onClick={() => requestDecision(row, 'approve')}
                    >
                      {busy ? 'Working…' : 'Mark as paid'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => requestDecision(row, 'reject')}
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
                    {row.earner.label}
                    <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                  </div>
                  {row.disbursementRef ? (
                    <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      Reference {row.disbursementRef}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>
                    {row.decidedAt ? formatDate(row.decidedAt) : '—'}
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

      <ConfirmDialog
        open={pendingDecision != null}
        title={pendingDecision?.action === 'approve' ? 'Send this payout?' : 'Reject this payout?'}
        summary={
          pendingDecision ? (
            pendingDecision.action === 'approve' ? (
              <>
                You are recording that {formatMoney(pendingDecision.row.amountMinor, pendingDecision.row.currency)}
                {' has been paid to '}
                <strong>{pendingDecision.row.earner.label}</strong>. Their balance drops by that amount and
                the request closes.
              </>
            ) : (
              <>
                <strong>{pendingDecision.row.earner.label}</strong> is told this request was turned down.
                No money moves and they can ask again.
              </>
            )
          ) : (
            ''
          )
        }
        details={
          pendingDecision
            ? [
                {
                  label: scope === 'partner' ? 'Restaurant' : 'Coach',
                  value: pendingDecision.row.earner.label,
                },
                {
                  label: 'Amount',
                  value: (
                    <span className="gt-numeric">
                      {formatMoney(pendingDecision.row.amountMinor, pendingDecision.row.currency)}
                    </span>
                  ),
                },
                {
                  label: 'Balance',
                  value: (
                    <span className="gt-numeric">
                      {pendingDecision.row.balanceMinor == null
                        ? '—'
                        : formatMoney(pendingDecision.row.balanceMinor, pendingDecision.row.currency)}
                    </span>
                  ),
                },
                ...(pendingDecision.action === 'approve'
                  ? [{ label: 'Reference', value: (refs[pendingDecision.row.id] ?? '').trim() }]
                  : []),
              ]
            : undefined
        }
        confirmLabel={
          pendingDecision && pendingDecision.action === 'approve'
            ? `Mark ${formatMoney(pendingDecision.row.amountMinor, pendingDecision.row.currency)} paid`
            : 'Reject request'
        }
        cancelLabel="Go back"
        busy={pendingDecision != null && busyId === pendingDecision.row.id}
        onCancel={() => setPendingDecision(null)}
        onConfirm={() => {
          if (!pendingDecision) return;
          const { row, action } = pendingDecision;
          setPendingDecision(null);
          void decide(row, action);
        }}
      />
    </div>
  );
}
