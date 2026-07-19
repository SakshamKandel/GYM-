'use client';

import { formatMoney } from '@gym/shared';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  StatusChip,
} from '@/components/console';

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

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

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

function targetLabel(t: MealPaymentRequestRow['target']): string {
  if (t.kind === 'order') {
    return t.deliveryDate ? `Order · ${t.deliveryDate} ${t.window ?? ''}`.trim() : 'Order';
  }
  return t.weekStart && t.weekEnd ? `Weekly plan · ${t.weekStart} – ${t.weekEnd}` : 'Weekly plan';
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
}: {
  requests: MealPaymentRequestRow[];
  counts: MealPaymentStatusCounts;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (tab === 'all') return requests;
    return requests.filter((r) => r.status === tab);
  }, [requests, tab]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const receiptBad = selected ? receiptUnusable(selected.receiptUrl) : false;

  function openRow(row: MealPaymentRequestRow) {
    setSelectedId(row.id);
    setNote('');
    setRefundReason('');
    setError(null);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
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
      setError('Network error.');
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
            ? 'Non-refundable — the order is in production/past cutoff, or the cycle week has begun.'
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
      setError('Network error.');
      setBusy(false);
    }
  }

  const columns: Column<MealPaymentRequestRow>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.account.displayName || r.account.email}
          </div>
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
          {DATE_FMT.format(new Date(r.createdAt))}
        </span>
      ),
    },
  ];

  return (
    <>
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
          empty="No requests in this status."
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
              <Row label="Submitted">{DATE_FMT.format(new Date(selected.createdAt))}</Row>
              {selected.decidedAt ? (
                <Row label="Decided">{DATE_FMT.format(new Date(selected.decidedAt))}</Row>
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
                    Approve is disabled until the receipt loads — reload the queue and try again.
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button variant="danger" disabled={busy} onClick={() => void decide('reject')}>
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
                  <Button variant="danger" disabled={busy} onClick={() => void refund()}>
                    {busy ? 'Refunding…' : 'Refund payment'}
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
          </div>
        ) : null}
      </Drawer>
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
