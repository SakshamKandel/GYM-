'use client';

import type { OrderStatus } from '@gym/shared';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  SearchField,
  SkeletonRows,
  Toolbar,
} from '@/components/console';
import {
  formatAge,
  formatDateLabel,
  formatDateTime,
  formatMoney,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
} from '@/lib/format';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { KeyboardRows } from '../../_components/KeyboardRows';
import { MemberLink } from '../../_components/MemberLink';
import { QueueTabs } from '../../_components/QueueTabs';
import { useUrlSearch, useUrlState } from '../../_components/useUrlState';

/**
 * Admin dispute queue (Pack E non-delivery rail / WP-8). Master/detail —
 * DataTable of every open/reviewing dispute (or a decided tab) opens a Drawer
 * with the member's reason/note, the linked order, and the resolve/reject
 * controls. `POST /api/admin/disputes/[id]` is ADMIN-AUTHORITATIVE and never
 * auto-refunds — a dispute that should get money back is refunded separately
 * on the Meal Payments queue; this drawer only records the outcome and tells
 * the member.
 *
 * ORDER OF OPERATIONS: mark resolved FIRST, then refund. The refund rail
 * refuses an order that is already delivered or past its cutoff unless that
 * order carries a resolved dispute, and every disputable order is one of those.
 * So the refund link belongs on a resolved dispute, not a live one — sending an
 * operator to the payments queue before they have decided the claim just earns
 * them a "not refundable" and no way forward.
 */

export interface DisputeRow {
  id: string;
  orderId: string;
  orderNumber: string;
  account: { id: string; email: string; displayName: string };
  partnerName: string;
  order: {
    totalMinor: number;
    currency: string;
    status: string;
    paymentStatus: string;
    deliveryDate: string;
    window: string;
  };
  reason: string;
  note: string;
  status: 'open' | 'reviewing' | 'resolved' | 'rejected';
  resolution: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const TABS = [
  { key: 'live', label: 'Needs a decision' },
  { key: 'resolved', label: 'Upheld' },
  { key: 'rejected', label: 'Not upheld' },
  { key: 'all', label: 'Everything' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
const TAB_KEYS: readonly TabKey[] = ['live', 'resolved', 'rejected', 'all'];

const REASON_LABEL: Record<string, string> = {
  not_delivered: 'Not delivered',
  wrong_items: 'Wrong items',
  quality: 'Quality issue',
  late: 'Arrived late',
  other: 'Other',
};

const STATUS_TONE: Record<DisputeRow['status'], 'warning' | 'info' | 'positive' | 'critical'> = {
  open: 'warning',
  reviewing: 'info',
  resolved: 'positive',
  rejected: 'critical',
};

/**
 * The words an operator would use, not the words the column stores. `rejected`
 * in particular was being title-cased straight out of the database onto a
 * screen where the rest of the copy already says "not upheld" — the same
 * outcome under two names, one of them harsher than the decision it records.
 */
const STATUS_LABEL: Record<DisputeRow['status'], string> = {
  open: 'Open',
  reviewing: 'Reviewing',
  resolved: 'Upheld',
  rejected: 'Not upheld',
};

/** A claim nobody has touched for this long is the thing to look at first. */
const STALE_MS = 2 * 24 * 60 * 60 * 1000;

function isWaiting(row: DisputeRow): boolean {
  return row.status === 'open' || row.status === 'reviewing';
}

function isStale(row: DisputeRow): boolean {
  if (!isWaiting(row)) return false;
  const started = new Date(row.createdAt).getTime();
  return Number.isFinite(started) && Date.now() - started > STALE_MS;
}

/** 'lunch' / 'dinner' → the words a person uses. Unknown/absent → ''. */
function windowText(w: string): string {
  return w === 'lunch' ? 'Lunch' : w === 'dinner' ? 'Dinner' : '';
}

/** Raw order status → the shared label; unknown/legacy values pass through. */
function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status as OrderStatus] ?? status;
}

/** The `status` query value each tab sends (page server-loads only the live
 * queue; a decided tab fetches on demand — dispute volume is small, so this
 * is a light on-demand round trip, not a paginated table). */
const TAB_STATUS: Record<TabKey, string | undefined> = {
  live: undefined, // uses the initial server-loaded prop, refreshed via router.refresh()
  resolved: 'resolved',
  rejected: 'rejected',
  all: 'all',
};

export function DisputesQueue({
  disputes: initialDisputes,
  canViewMembers,
  canRefund,
}: {
  disputes: DisputeRow[];
  /** Viewer holds `members.read`, so member names can link to the record. */
  canViewMembers: boolean;
  /** Viewer holds `payments.review` — the permission the refund page enforces. */
  canRefund: boolean;
}) {
  const router = useRouter();
  // Kept in the URL. Deciding a dispute usually means a detour to the order or
  // to Meal Payments to send the money back, and coming back to "Needs a
  // decision, unfiltered" every time is how the second half of a queue gets
  // worked twice.
  const [tab, setTab] = useUrlState<TabKey>('tab', 'live', TAB_KEYS);
  const [rows, setRows] = useState<DisputeRow[]>(initialDisputes);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useUrlSearch('q');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rejecting closes a member's complaint for good, so it takes a confirm.
  const [confirmingReject, setConfirmingReject] = useState(false);
  // Which decision is actually in flight, so one button says "Working…" and
  // the others just wait their turn.
  const [busyAction, setBusyAction] = useState<'reviewing' | 'resolved' | 'rejected' | null>(null);

  /** Loads the given tab's rows — the server-passed prop for 'live', an
   * on-demand fetch for decided tabs (dispute volume is small: one light
   * round trip per tab switch, not a paginated table). */
  async function loadTab(t: TabKey) {
    if (t === 'live') {
      setRows(initialDisputes);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/disputes?status=${TAB_STATUS[t]}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { disputes: DisputeRow[] };
      setRows(data.disputes);
    } finally {
      setLoading(false);
    }
  }

  // Reset to the server-loaded live queue whenever the underlying prop changes
  // (e.g. after router.refresh() following a decision made while on 'live').
  useEffect(() => {
    if (tab === 'live') setRows(initialDisputes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDisputes]);

  const primed = useRef(false);
  useEffect(() => {
    if (!primed.current) {
      primed.current = true;
      return;
    }
    void loadTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((d) =>
      [d.account.displayName, d.account.email, d.orderNumber, d.partnerName, d.note]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);
  const selected = rows.find((d) => d.id === selectedId) ?? null;

  function openRow(row: DisputeRow) {
    setSelectedId(row.id);
    setResolution('');
    setError(null);
    setConfirmingReject(false);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
    setConfirmingReject(false);
  }

  async function decide(toStatus: 'reviewing' | 'resolved' | 'rejected') {
    if (!selected) return;
    setBusy(true);
    setBusyAction(toStatus);
    setError(null);
    try {
      const res = await fetch(`/api/admin/disputes/${encodeURIComponent(selected.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ toStatus, resolution: resolution.trim() || undefined }),
      });
      if (!res.ok) {
        setError(
          res.status === 409
            ? 'This dispute already changed elsewhere. Refreshing.'
            : res.status === 403
              ? 'You are not allowed to review disputes.'
              : 'Could not save that decision. Try again.',
        );
        setBusy(false);
        setBusyAction(null);
        setConfirmingReject(false);
        if (res.status === 409) {
          setSelectedId(null);
          router.refresh();
          void loadTab(tab);
        }
        return;
      }
      setBusy(false);
      setBusyAction(null);
      setConfirmingReject(false);
      setSelectedId(null);
      // Refresh the server-loaded 'live' queue (stat tiles included) AND the
      // currently-viewed tab's own rows, so a decision made from 'all'/
      // 'resolved'/'rejected' doesn't leave a stale row behind.
      router.refresh();
      void loadTab(tab);
    } catch {
      setError('Could not reach us just now. Try again.');
      setBusy(false);
      setBusyAction(null);
      setConfirmingReject(false);
    }
  }

  const columns: Column<DisputeRow>[] = [
    // The claim is identified by the order it is about, so that leads the row
    // at full weight with the restaurant beneath it — it used to be the
    // smallest, dimmest thing on the line.
    {
      key: 'order',
      header: 'Order',
      width: 150,
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div
            className="gt-numeric"
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: 'var(--gt-text)',
            }}
          >
            {r.orderNumber}
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
            {r.partnerName}
          </div>
        </div>
      ),
    },
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
      key: 'reason',
      header: 'Reason',
      render: (r) => <span style={{ fontSize: 13 }}>{REASON_LABEL[r.reason] ?? r.reason}</span>,
    },
    // How long a member has been waiting on an answer. Past two days that stops
    // being neutral information, so it stops looking neutral.
    {
      key: 'age',
      header: 'Waiting',
      width: 90,
      align: 'right',
      render: (r) => (
        <span
          className="gt-numeric"
          style={{
            fontSize: 13,
            fontWeight: isStale(r) ? 600 : undefined,
            color: isStale(r) ? 'var(--gt-danger)' : 'var(--gt-text-dim)',
          }}
          title={`Reported ${formatDateTime(r.createdAt)}`}
        >
          {formatAge(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
    // The row's own way into the refund, for the common case where the claim is
    // obviously good: it lands on this order's receipt in Meal Payments, which
    // is the only place money actually moves. Only on a RESOLVED row — the
    // refund rail needs the resolution before it will let the money go, so
    // offering this on a live claim would be a link straight to a refusal.
    ...(canRefund
      ? [
          {
            key: 'refund',
            header: '',
            width: 90,
            align: 'right' as const,
            render: (r: DisputeRow) =>
              r.status === 'resolved' ? (
                <Link
                  href={`/admin/meal-payments?orderId=${encodeURIComponent(r.orderId)}`}
                  title={`Refund order ${r.orderNumber}`}
                  className="gt-btn"
                  data-variant="ghost"
                  data-size="sm"
                  style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  Refund
                </Link>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      {/* The queue's own state is the primary filter, so it reads as a
          segmented control rather than four look-alike buttons that had no
          hover, no pressed state and a 30px target. */}
      <Toolbar
        left={
          <QueueTabs
            label="Which claims to show"
            tabs={TABS}
            value={tab}
            onChange={setTab}
          />
        }
        right={
          <div style={{ width: 280, maxWidth: '100%' }}>
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Member, order or restaurant"
              aria-label="Search claims"
            />
          </div>
        }
      />

      {loading && rows.length === 0 ? (
        <SkeletonRows rows={5} cols={columns.length} />
      ) : tab === 'live' && rows.length === 0 && !query.trim() ? (
        <EmptyState
          title="Nothing to decide"
          description="When a member reports a problem with a delivered order, it lands here for review."
        />
      ) : (
        /* Switching tabs used to replace the table with five skeleton rows,
           so a twenty-row queue collapsed and sprang back and everything under
           it moved twice. The rows that are already here stay put and simply
           go quiet until the new ones arrive. No transition, so there is
           nothing for reduced-motion to suppress. */
        <KeyboardRows>
          <div aria-busy={loading} style={{ opacity: loading ? 0.55 : 1 }}>
            <DataTable
              columns={columns}
              rows={filtered}
              rowKey={(r) => r.id}
              onRowClick={openRow}
              rowAriaLabel={(r) =>
                `Open claim on order ${r.orderNumber} from ${r.account.displayName || r.account.email}`
              }
              empty={
                query.trim() ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      alignItems: 'center',
                    }}
                  >
                    <span>No claims match “{query.trim()}”.</span>
                    <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                      Clear search
                    </Button>
                  </div>
                ) : (
                  'No claims in this view.'
                )
              }
            />
          </div>
        </KeyboardRows>
      )}

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected ? `Order ${selected.orderNumber}` : 'Dispute'}
        width={460}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              <Badge tone="neutral">{REASON_LABEL[selected.reason] ?? selected.reason}</Badge>
            </div>

            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              Reported {formatDateTime(selected.createdAt)}
              {isWaiting(selected)
                ? ` · waiting ${formatAge(selected.createdAt)}`
                : selected.decidedAt
                  ? ` · decided ${formatDateTime(selected.decidedAt)}`
                  : ''}
            </div>

            <Row label="Member">
              <MemberLink
                id={selected.account.id}
                name={selected.account.displayName}
                email={selected.account.email}
                canView={canViewMembers}
                strong={false}
              />
              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{selected.account.email}</div>
            </Row>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
              <Row label="Restaurant">{selected.partnerName}</Row>
              <Row label="Order total">{formatMoney(selected.order.totalMinor, selected.order.currency)}</Row>
              <Row label="Delivery">
                {formatDateLabel(selected.order.deliveryDate)}
                {windowText(selected.order.window) ? ` · ${windowText(selected.order.window)}` : ''}
              </Row>
              <Row label="Order status">{orderStatusLabel(selected.order.status)}</Row>
              <Row label="Payment">
                {PAYMENT_STATUS_LABEL[selected.order.paymentStatus] ?? selected.order.paymentStatus}
              </Row>
            </div>

            <Row label="Member note">{selected.note || '—'}</Row>

            {selected.resolution ? <Row label="Resolution">{selected.resolution}</Row> : null}

            {selected.status === 'open' || selected.status === 'reviewing' ? (
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
                  placeholder="Resolution note (shown to the member)"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  disabled={busy}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
                {/* Marking resolved does not move money, but it is what lets
                    the money move: the refund rail only releases a delivered or
                    past-cutoff order once its claim has been upheld. So this
                    tells the operator the sequence instead of handing them a
                    link that would be refused. */}
                <div
                  style={{
                    padding: 12,
                    borderRadius: 'var(--gt-radius-sm)',
                    border: '1px solid var(--gt-border)',
                    background: 'var(--gt-surface-sunken)',
                    fontSize: 12,
                    color: 'var(--gt-text-dim)',
                  }}
                >
                  Marking this resolved does not move money on its own. Resolve it first, then the
                  refund for order {selected.orderNumber} opens on the Meal Payments queue.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selected.status === 'open' ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide('reviewing')}>
                      {busy && busyAction === 'reviewing' ? 'Working…' : 'Start review'}
                    </Button>
                  ) : null}
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => void decide('resolved')}>
                    {busy && busyAction === 'resolved' ? 'Working…' : 'Uphold this claim'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmingReject(true)}
                  >
                    {busy && busyAction === 'rejected' ? 'Working…' : 'Reject claim'}
                  </Button>
                </div>
              </div>
            ) : selected.status === 'resolved' ? (
              // An upheld claim is exactly when money can move, so this is where
              // the refund link belongs. It was the one place the drawer used to
              // say "no further action".
              <div
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--gt-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  This claim was upheld. If the member is owed their money back, refund it here.
                </div>
                {canRefund ? (
                  <Link
                    href={`/admin/meal-payments?orderId=${encodeURIComponent(selected.orderId)}`}
                    className="gt-btn"
                    data-variant="primary"
                    data-size="sm"
                    style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
                  >
                    Refund {formatMoney(selected.order.totalMinor, selected.order.currency)}
                  </Link>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                    You cannot issue refunds. Ask someone on the payments queue to refund order{' '}
                    {selected.orderNumber}.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                This claim was not upheld. No further action.
              </div>
            )}

            {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={selected != null && confirmingReject}
        title="Reject this claim?"
        summary={
          selected ? (
            <>
              <strong>{selected.account.displayName || selected.account.email}</strong> is told
              their claim about order {selected.orderNumber} was not upheld, and no money moves.
              The claim closes for good.
            </>
          ) : (
            ''
          )
        }
        details={
          selected
            ? [
                { label: 'Member', value: selected.account.displayName || selected.account.email },
                { label: 'Order', value: selected.orderNumber },
                { label: 'Claim', value: REASON_LABEL[selected.reason] ?? selected.reason },
                {
                  label: 'Order total',
                  value: (
                    <span className="gt-numeric">
                      {formatMoney(selected.order.totalMinor, selected.order.currency)}
                    </span>
                  ),
                },
              ]
            : undefined
        }
        confirmLabel="Reject claim"
        cancelLabel="Go back"
        busy={busy}
        onCancel={() => setConfirmingReject(false)}
        onConfirm={() => void decide('rejected')}
      >
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)' }}>
          {resolution.trim()
            ? `The member will read: “${resolution.trim()}”`
            : 'No note typed. Close this and add one so the member knows why.'}
        </p>
      </ConfirmDialog>
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
