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
  TierChip,
} from '@/components/console';

export type PaymentStatus = 'pending' | 'approved' | 'rejected';
export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

export interface PaymentRequestRow {
  id: string;
  accountId: string;
  accountEmail: string;
  accountDisplayName: string;
  tier: Tier;
  months: number;
  amountMinor: number;
  currency: string;
  method: 'esewa' | 'khalti' | 'bank' | 'other';
  receiptUrl: string | null;
  note: string | null;
  status: PaymentStatus;
  reviewNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const TABS: readonly { key: 'all' | PaymentStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const STATUS_CHIP: Record<
  PaymentStatus,
  { status: 'pending' | 'live' | 'ended'; label: string }
> = {
  pending: { status: 'pending', label: 'Pending' },
  approved: { status: 'live', label: 'Approved' },
  rejected: { status: 'ended', label: 'Rejected' },
};

const METHOD_LABEL: Record<PaymentRequestRow['method'], string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  bank: 'Bank transfer',
  other: 'Other',
};

/**
 * Manual Nepal-payments review queue (SCALE-UP-PLAN §1.5 / §4.1). The receipt
 * image is pre-signed server-side (payments/page.tsx mints it via the video
 * provider before this component ever mounts — the raw Cloudinary uid never
 * reaches the client). Approve/reject POST to the guarded
 * /api/admin/payment-requests/[id] route; approving runs a dated tier grant +
 * the promo commission hook server-side, so we just router.refresh() after.
 */
export function PaymentsQueue({ requests }: { requests: PaymentRequestRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (tab === 'all') return requests;
    return requests.filter((r) => r.status === tab);
  }, [requests, tab]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;

  function openRow(row: PaymentRequestRow) {
    setSelectedId(row.id);
    setNote('');
    setError(null);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
  }

  async function decide(action: 'approve' | 'reject') {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/payment-requests/${encodeURIComponent(selected.id)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action, note: note.trim() || undefined }),
        },
      );
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

  const columns: Column<PaymentRequestRow>[] = [
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
            {r.accountDisplayName || r.accountEmail}
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
            {r.accountEmail}
          </div>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      width: 100,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TierChip tier={r.tier} />
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            × {r.months}mo
          </span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      width: 100,
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
      width: 110,
      render: (r) => (
        <span style={{ fontSize: 13 }}>{METHOD_LABEL[r.method]}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (r) => (
        <StatusChip
          status={STATUS_CHIP[r.status].status}
          label={STATUS_CHIP[r.status].label}
        />
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      width: 130,
      align: 'right',
      render: (r) => (
        <span
          className="gt-numeric"
          style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}
        >
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
          const count =
            t.key === 'all'
              ? requests.length
              : requests.filter((r) => r.status === t.key).length;
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
                color: active ? '#fff' : 'var(--gt-text)',
                border: active
                  ? '1px solid var(--gt-red)'
                  : '1px solid var(--gt-border)',
              }}
            >
              {t.label} · {count}
            </button>
          );
        })}
      </div>

      {requests.length === 0 ? (
        <EmptyState
          title="No payment requests yet"
          description="Manual eSewa/Khalti/bank payments submitted from the app appear here for review."
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
        title={selected ? `${selected.accountDisplayName || selected.accountEmail}` : 'Payment'}
        width={460}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              {selected.accountEmail}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <TierChip tier={selected.tier} />
              <StatusChip
                status={STATUS_CHIP[selected.status].status}
                label={STATUS_CHIP[selected.status].label}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                fontSize: 14,
              }}
            >
              <Row label="Duration">{selected.months} month{selected.months === 1 ? '' : 's'}</Row>
              <Row label="Amount">{formatMoney(selected.amountMinor, selected.currency)}</Row>
              <Row label="Method">{METHOD_LABEL[selected.method]}</Row>
              <Row label="Submitted">{DATE_FMT.format(new Date(selected.createdAt))}</Row>
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
              {selected.receiptUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.receiptUrl}
                  alt="Payment receipt"
                  style={{
                    width: '100%',
                    maxHeight: 360,
                    objectFit: 'contain',
                    borderRadius: 10,
                    border: '1px solid var(--gt-border)',
                    background: 'var(--gt-bg)',
                  }}
                />
              ) : (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  Receipt image unavailable.
                </div>
              )}
            </div>

            {selected.reviewNote ? (
              <Row label="Review note">{selected.reviewNote}</Row>
            ) : null}

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
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void decide('reject')}
                  >
                    {busy ? 'Saving…' : 'Reject'}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void decide('approve')}
                  >
                    {busy ? 'Saving…' : 'Approve'}
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? (
              <div style={{ color: '#ff8178', fontSize: 13 }}>{error}</div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}
