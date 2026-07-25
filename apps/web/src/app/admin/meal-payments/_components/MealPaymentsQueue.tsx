'use client';

import { orderNumber } from '@gym/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  SearchField,
  StatusChip,
} from '@/components/console';
import { formatDateLabel, formatDateTime, formatMoney } from '@/lib/format';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { MemberLink } from '../../_components/MemberLink';

export type MealPaymentStatus = 'pending' | 'approved' | 'rejected' | 'refunded';

export interface MealPaymentStatusCounts {
  pending: number;
  approved: number;
  rejected: number;
  refunded: number;
}

type OrderTarget = {
  kind: 'order';
  id: string | null;
  totalMinor: number | null;
  status: string | null;
  paymentStatus: string | null;
  deliveryDate: string | null;
  window: string | null;
};

type CycleTarget = {
  kind: 'cycle';
  id: string | null;
  amountMinor: number | null;
  status: string | null;
  weekStart: string | null;
  weekEnd: string | null;
};

export interface MealPaymentRequestRow {
  id: string;
  account: { id: string; email: string; displayName: string };
  target: OrderTarget | CycleTarget;
  amountMinor: number;
  currency: string;
  method: 'esewa' | 'khalti';
  receiptUrl: string;
  note: string | null;
  status: MealPaymentStatus;
  reviewNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const TABS: readonly { key: 'all' | MealPaymentStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'all', label: 'All' },
];

const METHOD_LABEL: Record<MealPaymentRequestRow['method'], string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
};

const STATUS_CHIP: Record<MealPaymentStatus, { status: 'pending' | 'live' | 'ended'; label: string }> =
  {
    pending: { status: 'pending', label: 'Pending' },
    approved: { status: 'live', label: 'Approved' },
    rejected: { status: 'ended', label: 'Rejected' },
    refunded: { status: 'ended', label: 'Refunded' },
  };

/** True when the receipt URL isn't a loadable image (e.g. the server's
 * degraded 'unsigned:<uid>' placeholder when Cloudinary signing is unconfigured). */
function receiptUnusable(url: string): boolean {
  return !/^https?:\/\//i.test(url);
}

/** 'lunch' / 'dinner' → the words a person uses. Unknown/absent → ''. */
function windowText(w: string | null): string {
  return w === 'lunch' ? 'Lunch' : w === 'dinner' ? 'Dinner' : '';
}

/**
 * What this receipt is paying for. Order targets lead with the SAME order
 * number the orders board and the dispute queue show (`orderNumber(id)`) —
 * before this, disputes named an order one way and the refund queue another, so
 * the handoff between them was a manual guessing game.
 */
function targetLabel(t: MealPaymentRequestRow['target']): string {
  if (t.kind === 'order') {
    const parts = [t.id ? `Order ${orderNumber(t.id)}` : 'Order'];
    if (t.deliveryDate) parts.push(formatDateLabel(t.deliveryDate));
    const w = windowText(t.window);
    if (w) parts.push(w);
    return parts.join(' · ');
  }
  return t.weekStart && t.weekEnd
    ? `Weekly plan · ${formatDateLabel(t.weekStart)} – ${formatDateLabel(t.weekEnd)}`
    : 'Weekly plan';
}

/**
 * Web mirror of the mobile admin meal-payments screen (WP-11 / P0-10) — the
 * nav link 404'd because this page never existed. Talks to the SAME,
 * UNCHANGED API the mobile app and the mobile-parity queue already use:
 * `POST /api/admin/meal-payments/[id]` (approve/reject) and
 * `POST /api/admin/meal-payments/[id]/refund`. `router.refresh()` after any
 * decision reloads the server-rendered queue + stat tiles.
 */
export function MealPaymentsQueue({
  requests,
  counts,
  canViewMembers,
  focusOrderId,
}: {
  requests: MealPaymentRequestRow[];
  counts: MealPaymentStatusCounts;
  /** Viewer holds `members.read`, so member names can link to the record. */
  canViewMembers: boolean;
  /**
   * Order this queue was opened FOR — the disputes queue links here with
   * `?orderId=`, because a dispute that deserves money back is refunded on this
   * page and nowhere else. We open that order's receipt straight away instead of
   * making the operator find it.
   */
  focusOrderId: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which irreversible action is waiting on a confirm ('refund' moves money
  // back, 'reject' turns down a receipt the member says they paid).
  const [pendingAction, setPendingAction] = useState<'refund' | 'reject' | null>(null);

  // Deep link from a dispute: find that order's receipt, switch to the tab that
  // holds it, and open it. Runs once per incoming orderId.
  const focusTarget = useMemo(
    () =>
      focusOrderId
        ? requests.find((r) => r.target.kind === 'order' && r.target.id === focusOrderId) ?? null
        : null,
    [focusOrderId, requests],
  );

  // Applied ONCE per incoming order id: after a refund the page refreshes and
  // `requests` gets a new identity, and without this guard the drawer would pop
  // straight back open on the row that was just decided.
  const appliedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusOrderId || appliedFocus.current === focusOrderId) return;
    appliedFocus.current = focusOrderId;
    if (!focusTarget) return;
    setTab(focusTarget.status);
    setSelectedId(focusTarget.id);
    setNote('');
    setRefundReason('');
    setError(null);
  }, [focusOrderId, focusTarget]);

  const filtered = useMemo(() => {
    // The server ships pending-first then decided (each newest-first within its
    // own group, so an old unreviewed receipt can never be truncated away), so
    // the "All" tab must be re-sorted globally by submitted-time to read as one
    // reverse-chronological stream instead of two stitched blocks.
    const inTab =
      tab === 'all'
        ? [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : requests.filter((r) => r.status === tab);
    const q = query.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter((r) =>
      [r.account.displayName, r.account.email, targetLabel(r.target)]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [requests, tab, query]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const receiptBad = selected ? receiptUnusable(selected.receiptUrl) : false;

  function openRow(row: MealPaymentRequestRow) {
    setSelectedId(row.id);
    setNote('');
    setRefundReason('');
    setError(null);
    setPendingAction(null);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
    setPendingAction(null);
  }

  function tabCount(key: 'all' | MealPaymentStatus): number {
    if (key === 'all') return counts.pending + counts.approved + counts.rejected + counts.refunded;
    return counts[key];
  }

  async function decide(action: 'approve' | 'reject') {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/meal-payments/${encodeURIComponent(selected.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      if (res.status === 409) {
        setError('Another admin already decided this. Refreshing…');
        setBusy(false);
        setSelectedId(null);
        router.refresh();
        return;
      }
      if (res.status === 404) {
        setError('This request no longer exists. Refreshing…');
        setBusy(false);
        setSelectedId(null);
        router.refresh();
        return;
      }
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to review payments.'
            : 'Could not save that decision. Try again.',
        );
        setBusy(false);
        return;
      }
      setBusy(false);
      setSelectedId(null);
      router.refresh();
    } catch {
      setError('Could not reach us just now. Try again.');
      setBusy(false);
    }
  }

  async function refund() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/meal-payments/${encodeURIComponent(selected.id)}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reason: refundReason.trim() || undefined }),
        },
      );
      if (res.status === 409) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          data?.error === 'non_refundable'
            ? 'Non-refundable. The order is in production or past cutoff, or the cycle week has begun.'
            : 'This payment was already refunded or is no longer approved. Refreshing…',
        );
        setBusy(false);
        setSelectedId(null);
        router.refresh();
        return;
      }
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to refund payments.'
            : 'Could not refund this payment. Try again.',
        );
        setBusy(false);
        return;
      }
      setBusy(false);
      setSelectedId(null);
      router.refresh();
    } catch {
      setError('Could not reach us just now. Try again.');
      setBusy(false);
    }
  }

  /**
   * Runs whichever irreversible action the confirm dialog was opened for, then
   * closes it. One exit point, so no error path can leave the dialog stuck open
   * over a decision that already went through.
   */
  async function runPendingAction() {
    if (pendingAction === 'refund') await refund();
    else if (pendingAction === 'reject') await decide('reject');
    setPendingAction(null);
  }

  const columns: Column<MealPaymentRequestRow>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <MemberLink
            id={r.account.id}
            name={r.account.displayName}
            email={r.account.email}
            canView={canViewMembers}
          />
          <div
            style={{
              fontSize: 12,
              color: 'var(--gt-text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.account.email}
          </div>
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      render: (r) => <span style={{ fontSize: 13 }}>{targetLabel(r.target)}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      width: 110,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {formatMoney(r.amountMinor, r.currency)}
        </span>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      width: 100,
      render: (r) => <span style={{ fontSize: 13 }}>{METHOD_LABEL[r.method]}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (r) => (
        <StatusChip status={STATUS_CHIP[r.status].status} label={STATUS_CHIP[r.status].label} />
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      width: 130,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      {focusOrderId && !focusTarget ? (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--gt-warning) 40%, transparent)',
            background: 'var(--gt-warning-weak)',
            color: 'var(--gt-text)',
            fontSize: 13,
          }}
        >
          No manual payment on file for order {orderNumber(focusOrderId)}. Nothing to refund here,
          so that order was paid another way (cash on delivery, or a card).
        </div>
      ) : null}

      <div style={{ marginBottom: 16, maxWidth: 340 }}>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search member, email or order"
          aria-label="Search meal payments"
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '7px 14px',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                fontSize: 13,
                fontWeight: 600,
                background: active ? 'var(--gt-red)' : 'transparent',
                color: active ? 'var(--gt-accent-ink)' : 'var(--gt-text)',
                border: active ? '1px solid var(--gt-red)' : '1px solid var(--gt-border)',
              }}
            >
              {t.label} · {tabCount(t.key)}
            </button>
          );
        })}
      </div>

      {requests.length === 0 ? (
        <EmptyState
          title="No meal payment requests yet"
          description="Manual eSewa/Khalti receipts for meal orders and weekly subscription cycles appear here for review."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={openRow}
          rowAriaLabel={(r) =>
            `Review ${r.account.displayName || r.account.email}'s ${formatMoney(r.amountMinor, r.currency)} receipt`
          }
          empty={
            query.trim() ? 'No receipts match that search.' : 'No requests in this status.'
          }
        />
      )}

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected ? selected.account.displayName || selected.account.email : 'Meal payment'}
        width={460}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{selected.account.email}</div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <StatusChip
                status={STATUS_CHIP[selected.status].status}
                label={STATUS_CHIP[selected.status].label}
              />
              <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                {targetLabel(selected.target)}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
              <Row label="Amount">{formatMoney(selected.amountMinor, selected.currency)}</Row>
              <Row label="Method">{METHOD_LABEL[selected.method]}</Row>
              <Row label="Submitted">{formatDateTime(selected.createdAt)}</Row>
              {selected.decidedAt ? (
                <Row label="Decided">{formatDateTime(selected.decidedAt)}</Row>
              ) : null}
            </div>

            {selected.note ? <Row label="Member note">{selected.note}</Row> : null}

            <div>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                  marginBottom: 8,
                }}
              >
                Receipt
              </div>
              {receiptBad ? (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  Receipt image unavailable.
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.receiptUrl}
                  alt="Meal payment receipt"
                  style={{
                    width: '100%',
                    maxHeight: 360,
                    objectFit: 'contain',
                    borderRadius: 10,
                    border: '1px solid var(--gt-border)',
                    background: 'var(--gt-bg)',
                  }}
                />
              )}
            </div>

            {selected.reviewNote ? <Row label="Review note">{selected.reviewNote}</Row> : null}

            {selected.status === 'pending' ? (
              <div
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--gt-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <textarea
                  className="gt-input"
                  placeholder="Note (optional, shown to the member)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  disabled={busy}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
                {receiptBad ? (
                  <div style={{ fontSize: 12, color: 'var(--gt-warning)' }}>
                    Approve is disabled until the receipt loads. Reload the queue and try again.
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button variant="danger" disabled={busy} onClick={() => setPendingAction('reject')}>
                    {busy ? 'Saving…' : 'Reject'}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || receiptBad}
                    onClick={() => void decide('approve')}
                  >
                    {busy ? 'Saving…' : 'Approve'}
                  </Button>
                </div>
              </div>
            ) : null}

            {selected.status === 'approved' ? (
              <div
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--gt-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  Refunding reverses the paid mark. Refused once the order is in production/past
                  cutoff, or the cycle&apos;s week has begun.
                </div>
                <textarea
                  className="gt-input"
                  placeholder="Refund reason (optional, audited)"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  disabled={busy}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div>
                  {/* Money leaving the business never fires on one click — the
                      confirm names the member and the exact amount (FIX 5). */}
                  <Button variant="danger" disabled={busy} onClick={() => setPendingAction('refund')}>
                    {busy ? 'Refunding…' : 'Refund payment'}
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={selected != null && pendingAction != null}
        title={pendingAction === 'refund' ? 'Refund this payment?' : 'Reject this receipt?'}
        summary={
          selected ? (
            pendingAction === 'refund' ? (
              <>
                {formatMoney(selected.amountMinor, selected.currency)} goes back to{' '}
                <strong>{selected.account.displayName || selected.account.email}</strong> and the
                paid mark is reversed. This cannot be undone.
              </>
            ) : (
              <>
                <strong>{selected.account.displayName || selected.account.email}</strong> is told
                their {formatMoney(selected.amountMinor, selected.currency)} receipt was not
                accepted, and nothing is marked paid.
              </>
            )
          ) : (
            ''
          )
        }
        details={
          selected
            ? [
                { label: 'Member', value: selected.account.displayName || selected.account.email },
                { label: 'Paying for', value: targetLabel(selected.target) },
                {
                  label: 'Amount',
                  value: (
                    <span className="gt-numeric">
                      {formatMoney(selected.amountMinor, selected.currency)}
                    </span>
                  ),
                },
                { label: 'Method', value: METHOD_LABEL[selected.method] },
              ]
            : undefined
        }
        confirmLabel={
          selected && pendingAction === 'refund'
            ? `Refund ${formatMoney(selected.amountMinor, selected.currency)}`
            : 'Reject receipt'
        }
        busyLabel={pendingAction === 'refund' ? 'Refunding…' : 'Saving…'}
        cancelLabel="Go back"
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void runPendingAction()}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}
