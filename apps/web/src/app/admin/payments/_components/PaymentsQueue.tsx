'use client';

import { compareTiers, effectiveTier, formatMoney } from '@gym/shared';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  type Column,
  ConfirmButton,
  DataTable,
  Drawer,
  EmptyState,
  SearchField,
  StatusChip,
  TierChip,
} from '@/components/console';

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'refunded';
export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

export interface PaymentStatusCounts {
  pending: number;
  approved: number;
  rejected: number;
  refunded: number;
}

export interface PaymentRequestRow {
  id: string;
  accountId: string;
  accountEmail: string;
  accountDisplayName: string;
  /** The member's CURRENT stored tier — drives the approve-time window preview (P0-2). */
  accountTier: Tier;
  /** ISO string when the member's current tier lapses, or null = permanent. */
  accountTierExpiresAt: string | null;
  tier: Tier;
  months: number;
  region: 'NP' | 'INTL';
  /** NP pricing without a verified NP country (B11) — reviewer should double-check. */
  selfReportedRegion: boolean;
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

/** Server 409 { error:'confirm_required', preview } shape (P0-2 / B1). */
interface WindowPreview {
  reason?: 'permanent_current' | 'higher_current';
  action: 'extend' | 'overwrite';
  currentTier: Tier;
  currentExpiresAt: string | null;
  resultTier: Tier;
  resultExpiresAt: string;
}

const TABS: readonly { key: 'all' | PaymentStatus; label: string }[] = [
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

const DATE_ONLY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const STATUS_CHIP: Record<PaymentStatus, { status: 'pending' | 'live' | 'ended'; label: string }> =
  {
    pending: { status: 'pending', label: 'Pending' },
    approved: { status: 'live', label: 'Approved' },
    rejected: { status: 'ended', label: 'Rejected' },
    refunded: { status: 'ended', label: 'Refunded' },
  };

const METHOD_LABEL: Record<PaymentRequestRow['method'], string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  bank: 'Bank transfer',
  other: 'Other',
};

/**
 * Adds `months` calendar months, day-clamped — client mirror of the server's
 * addCalendarMonths (B9), used only for the approve-time preview (P0-2). Local
 * time is fine here; the server recomputes authoritatively on approve.
 */
function addCalendarMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

/**
 * Computes the post-approval tier window shown in the decide drawer (P0-2).
 * Mirrors the server's planWindow (B1): extend a same-tier finite window,
 * overwrite an expired/lower/starter one, and flag a shorten/downgrade that
 * needs confirm.
 */
function previewWindow(row: PaymentRequestRow): WindowPreview & { needsConfirm: boolean } {
  const now = new Date();
  const curExp = row.accountTierExpiresAt ? new Date(row.accountTierExpiresAt) : null;
  const currentEff = effectiveTier(row.accountTier, row.accountTierExpiresAt, now) as Tier;
  const currentActive =
    currentEff !== 'starter' && (curExp === null || curExp.getTime() > now.getTime());
  const currentPermanent = currentEff !== 'starter' && curExp === null;
  const cmp = compareTiers(currentEff, row.tier);

  if (cmp === 0 && currentActive && !currentPermanent && curExp) {
    return {
      reason: undefined,
      action: 'extend',
      currentTier: currentEff,
      currentExpiresAt: row.accountTierExpiresAt,
      resultTier: row.tier,
      resultExpiresAt: addCalendarMonths(curExp, row.months).toISOString(),
      needsConfirm: false,
    };
  }
  if (currentActive && (cmp > 0 || currentPermanent)) {
    return {
      reason: currentPermanent ? 'permanent_current' : 'higher_current',
      action: 'overwrite',
      currentTier: currentEff,
      currentExpiresAt: row.accountTierExpiresAt,
      resultTier: row.tier,
      resultExpiresAt: addCalendarMonths(now, row.months).toISOString(),
      needsConfirm: true,
    };
  }
  return {
    reason: undefined,
    action: 'overwrite',
    currentTier: currentEff,
    currentExpiresAt: row.accountTierExpiresAt,
    resultTier: row.tier,
    resultExpiresAt: addCalendarMonths(now, row.months).toISOString(),
    needsConfirm: false,
  };
}

function expiryLabel(iso: string | null): string {
  if (!iso) return 'no expiry';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'no expiry';
  return DATE_ONLY.format(d);
}

/**
 * Manual Nepal-payments review queue (SCALE-UP-PLAN §1.5 / §4.1). Approve/reject
 * POST to the guarded /api/admin/payment-requests/[id] route; an approval that
 * would shorten/downgrade the member's current tier returns 409 confirm_required
 * (P0-2) — we surface the preview and re-POST with confirm:true. Approved rows
 * can be refunded (P0-1) via the [id]/refund route. router.refresh() after any
 * mutation reloads the server-rendered queue.
 */
export function PaymentsQueue({
  requests,
  counts,
}: {
  requests: PaymentRequestRow[];
  counts: PaymentStatusCounts;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server asks for explicit confirmation of a shorten/downgrade.
  const [confirmPreview, setConfirmPreview] = useState<WindowPreview | null>(null);

  const filtered = useMemo(() => {
    // The server ships pending-first then decided (each newest-first within its
    // group), so the "All" tab must be re-sorted globally by submitted-time to
    // read as one reverse-chronological stream instead of two stitched blocks.
    const base =
      tab === 'all'
        ? [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : requests.filter((r) => r.status === tab);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) =>
        r.accountDisplayName.toLowerCase().includes(q) ||
        r.accountEmail.toLowerCase().includes(q),
    );
  }, [requests, tab, query]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const preview = selected && selected.status === 'pending' ? previewWindow(selected) : null;

  function openRow(row: PaymentRequestRow) {
    setSelectedId(row.id);
    setNote('');
    setRefundReason('');
    setError(null);
    setConfirmPreview(null);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
  }

  function tabCount(key: 'all' | PaymentStatus): number {
    if (key === 'all') {
      return counts.pending + counts.approved + counts.rejected + counts.refunded;
    }
    return counts[key];
  }

  async function decide(action: 'approve' | 'reject', opts?: { confirm?: boolean }) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payment-requests/${encodeURIComponent(selected.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, note: note.trim() || undefined, confirm: opts?.confirm }),
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; preview?: WindowPreview }
          | null;
        if (data?.error === 'confirm_required' && data.preview) {
          setConfirmPreview(data.preview);
          setBusy(false);
          return;
        }
        // already_decided — another admin got here first (B13).
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
        `/api/admin/payment-requests/${encodeURIComponent(selected.id)}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reason: refundReason.trim() || undefined }),
        },
      );
      if (res.status === 409) {
        setError('This payment was already refunded or is no longer approved. Refreshing…');
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
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>× {r.months}mo</span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      width: 110,
      align: 'right',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {r.selfReportedRegion ? (
            <span
              title="NP pricing without a verified NP country — check the receipt currency"
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--gt-warning)',
                border: '1px solid var(--gt-warning)',
                borderRadius: 5,
                padding: '1px 4px',
                letterSpacing: '0.03em',
              }}
            >
              NP?
            </span>
          ) : null}
          <span className="gt-numeric" style={{ fontSize: 13 }}>
            {formatMoney(r.amountMinor, r.currency)}
          </span>
        </span>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      width: 110,
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
      <div style={{ marginBottom: 16 }}>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by member name or email"
          aria-label="Search payments by member"
          style={{ maxWidth: 320 }}
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
          title="No payment requests yet"
          description="Manual eSewa/Khalti/bank payments submitted from the app appear here for review."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={openRow}
          empty={query.trim() ? 'No matching members.' : 'No requests in this status.'}
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
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{selected.accountEmail}</div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <TierChip tier={selected.tier} />
              <StatusChip
                status={STATUS_CHIP[selected.status].status}
                label={STATUS_CHIP[selected.status].label}
              />
              {selected.selfReportedRegion ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--gt-warning)',
                    border: '1px solid var(--gt-warning)',
                    borderRadius: 6,
                    padding: '2px 6px',
                  }}
                >
                  Self-reported NP region
                </span>
              ) : null}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                fontSize: 14,
              }}
            >
              <Row label="Duration">
                {selected.months} month{selected.months === 1 ? '' : 's'}
              </Row>
              <Row label="Amount">{formatMoney(selected.amountMinor, selected.currency)}</Row>
              <Row label="Method">{METHOD_LABEL[selected.method]}</Row>
              <Row label="Submitted">{DATE_FMT.format(new Date(selected.createdAt))}</Row>
            </div>

            {selected.note ? <Row label="Member note">{selected.note}</Row> : null}

            {/* Approve-time window preview (P0-2) — only meaningful while pending. */}
            {preview ? (
              <div
                style={{
                  border: '1px solid var(--gt-border)',
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: 'var(--gt-text-dim)',
                    fontFamily: 'var(--font-heading)',
                  }}
                >
                  On approval ({preview.action})
                </div>
                <div>
                  Current:{' '}
                  <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>
                    {preview.currentTier}
                  </span>{' '}
                  <span style={{ color: 'var(--gt-text-dim)' }}>
                    ({expiryLabel(preview.currentExpiresAt)})
                  </span>
                </div>
                <div>
                  After:{' '}
                  <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>
                    {preview.resultTier}
                  </span>{' '}
                  <span style={{ color: 'var(--gt-text-dim)' }}>
                    (until {expiryLabel(preview.resultExpiresAt)})
                  </span>
                </div>
                {preview.needsConfirm ? (
                  <div style={{ color: 'var(--gt-warning)', fontSize: 12 }}>
                    {preview.reason === 'higher_current'
                      ? 'This would downgrade an active higher tier — confirm required.'
                      : 'This would put an expiry on a permanent tier — confirm required.'}
                  </div>
                ) : null}
              </div>
            ) : null}

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
                {confirmPreview ? (
                  <div
                    style={{
                      border: '1px solid var(--gt-warning)',
                      borderRadius: 10,
                      padding: 12,
                      fontSize: 13,
                      color: 'var(--gt-text)',
                    }}
                  >
                    {confirmPreview.reason === 'higher_current'
                      ? `This member currently has an active ${confirmPreview.currentTier.toUpperCase()} tier. Approving downgrades them to ${confirmPreview.resultTier.toUpperCase()} until ${expiryLabel(confirmPreview.resultExpiresAt)}.`
                      : `This member currently has a permanent ${confirmPreview.currentTier.toUpperCase()} tier. Approving replaces it with ${confirmPreview.resultTier.toUpperCase()} until ${expiryLabel(confirmPreview.resultExpiresAt)}.`}
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button variant="danger" disabled={busy} onClick={() => void decide('reject')}>
                    {busy ? 'Saving…' : 'Reject'}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void decide('approve', { confirm: confirmPreview != null })}
                  >
                    {busy
                      ? 'Saving…'
                      : confirmPreview
                        ? 'Confirm & approve'
                        : 'Approve'}
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
                  Refunding removes the granted tier and claws back any coach commission.
                </div>
                <textarea
                  className="gt-input"
                  placeholder="Refund reason (optional)"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  disabled={busy}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div>
                  {/* P0-5: a refund claws back coach commission and rolls back
                      the granted tier — irreversible, so require an explicit
                      two-step confirm rather than firing on a single click. */}
                  <ConfirmButton
                    label="Refund payment"
                    confirmLabel="Confirm refund"
                    busyLabel="Refunding…"
                    busy={busy}
                    onConfirm={() => void refund()}
                  />
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
