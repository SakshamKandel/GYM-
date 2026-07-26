'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  SkeletonRows,
  TextField,
  TierChip,
} from '@/components/console';
import { formatAge, formatDate, formatMoney } from '@/lib/format';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { QueueTabs } from '../../_components/QueueTabs';

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
 * "Asked 3d ago · Jul 22, 2026" — how long someone has been waiting for their
 * money, then the day they asked. `formatAge` returns a bare unit for anything
 * under a month and an absolute date beyond it, so the two forms are worded
 * separately rather than gluing "ago" onto a date.
 */
function askedLabel(requestedAt: string): string {
  const age = formatAge(requestedAt);
  const day = formatDate(requestedAt);
  if (age === day) return `Asked ${day}`;
  if (age === 'now') return `Asked just now · ${day}`;
  return `Asked ${age} ago · ${day}`;
}

/** The quiet uppercase label that opens a block inside this queue. */
function SectionLabel({ label, count }: { label: string; count?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
        fontSize: 'var(--gt-fs-micro)',
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color: 'var(--gt-text-dim)',
        fontFamily: 'var(--font-heading)',
      }}
    >
      {label}
      {count != null ? (
        <span className="gt-numeric" style={{ color: 'var(--gt-text)' }}>
          {count}
        </span>
      ) : null}
    </div>
  );
}

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
    <QueueTabs
      label="Who is being paid"
      tabs={SCOPES.map((s) => ({ key: s.key, label: s.label, disabled: busyId !== null }))}
      value={scope}
      onChange={switchScope}
    />
  );

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {scopeTabs}
        {/* Table-shaped placeholder rather than the word "Loading", so the page
            keeps its height and the swap to real rows doesn't jump. */}
        <SkeletonRows rows={3} cols={3} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {scopeTabs}
        <div role="alert">
          <EmptyState
            title={loadError}
            description="Nothing is shown here rather than a list that might be out of date."
            action={
              <Button variant="ghost" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
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
        <SectionLabel
          label="Waiting to be paid"
          count={pending.length > 0 ? pending.length : undefined}
        />
        {pending.length === 0 ? (
          <EmptyState
            title="Nobody is waiting to be paid"
            description={
              scope === 'partner'
                ? 'When a restaurant asks for its money, the request shows up here.'
                : 'When a coach asks for their money, the request shows up here.'
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
                  className="gt-card"
                  style={{ padding: 16 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontWeight: 600,
                          fontSize: 'var(--gt-fs-h2)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        {row.earner.label}
                        {row.earner.coachTier ? <TierChip tier={row.earner.coachTier} /> : null}
                      </div>
                      {/* How long they have been waiting comes first; the exact
                          day follows it, because "9d" is what decides the order
                          you work through these in. */}
                      <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 4 }}>
                        {askedLabel(row.requestedAt)}
                      </div>
                    </div>
                    <div
                      style={{
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: 4,
                      }}
                    >
                      <div
                        className="gt-numeric"
                        style={{
                          fontSize: 'var(--gt-fs-h1)',
                          lineHeight: 1.2,
                          color: 'var(--gt-text)',
                        }}
                      >
                        {formatMoney(row.amountMinor, row.currency)}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--gt-text-dim)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span>
                          Balance{' '}
                          <span className="gt-numeric">
                            {row.balanceMinor == null
                              ? '—'
                              : formatMoney(row.balanceMinor, row.currency)}
                          </span>
                        </span>
                        {covered ? null : <Badge tone="critical">Not enough</Badge>}
                      </div>
                    </div>
                  </div>

                  {/* Same control order on every row: reference, then the quiet
                      turn-down, then the action that moves the money. */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-end',
                      marginTop: 14,
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
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => requestDecision(row, 'reject')}
                    >
                      Reject
                    </Button>
                    {/* Dark, not accent: a queue of ten rows would otherwise put
                        ten accent buttons on one screen and the accent would
                        stop meaning "the important one". */}
                    <Button
                      variant="dark"
                      size="sm"
                      disabled={busy}
                      onClick={() => requestDecision(row, 'approve')}
                    >
                      {busy ? 'Working…' : 'Mark as paid'}
                    </Button>
                  </div>

                  {rowError[row.id] ? (
                    <div
                      role="alert"
                      style={{
                        marginTop: 10,
                        border: '1px solid color-mix(in srgb, var(--gt-danger) 38%, transparent)',
                        background: 'var(--gt-danger-weak)',
                        borderRadius: 'var(--gt-radius-sm)',
                        padding: '10px 12px',
                        color: 'var(--gt-text)',
                        fontSize: 13,
                        lineHeight: 1.45,
                      }}
                    >
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
        <SectionLabel label="Already decided" />
        {history.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Nothing has been decided yet.
          </div>
        ) : (
          // Settled history is reference material, so it stays quiet: hairline
          // rows, dim ink, and the amount tabular on the right where it lines up
          // with the row above it.
          <div className="gt-card" style={{ padding: 0 }}>
            {history.map((row, i) => (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  borderBottom:
                    i === history.length - 1 ? 'none' : '1px solid var(--gt-border)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    {row.earner.label}
                    <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gt-text-faint)', marginTop: 2 }}>
                    {row.decidedAt ? formatDate(row.decidedAt) : 'No date on record'}
                    {row.disbursementRef ? ` · reference ${row.disbursementRef}` : ''}
                  </div>
                </div>
                <span
                  className="gt-numeric"
                  style={{
                    fontSize: 'var(--gt-fs-meta)',
                    whiteSpace: 'nowrap',
                    color: 'var(--gt-text)',
                  }}
                >
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
