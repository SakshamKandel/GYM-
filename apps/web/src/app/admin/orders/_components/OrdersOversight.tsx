'use client';

import { ORDER_STATUSES, canActorAdvance, orderNumber, type OrderStatus } from '@gym/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Drawer,
  SearchField,
  Toolbar,
} from '@/components/console';
import {
  formatDateLabel,
  formatMoney,
  formatShortDateTime,
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_LABEL,
  PAYMENT_STATUS_LABEL,
  windowLabel,
  windowShort,
} from '@/lib/format';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { DownloadCsv } from '../../_components/DownloadCsv';
import { MemberLink } from '../../_components/MemberLink';
import type { AdminOrderRow } from '../_data';
import { OrderTimeline } from './OrderTimeline';

// Client-only: Leaflet touches `window` at import, so never SSR this.
const LocationPicker = dynamic(
  () => import('@/components/console/LocationPicker').then((m) => m.LocationPicker),
  { ssr: false, loading: () => null },
);

/**
 * Admin all-partner order oversight (plan §2/§3/§7 P6). Toolbar+DataTable+
 * review Drawer (queue-page template): server-driven date/partner/status/scope
 * filters AND the free-text search box all re-fetch the guarded API route
 * (B14 — search used to filter only the already-fetched page; a debounced
 * `q` param now matches the full server-side set, same idiom as the members
 * directory). The Drawer's action buttons are computed from
 * `canActorAdvance(from, to, 'admin')` — this UI can never offer a transition
 * the server would reject, and `POST …/override` re-validates it anyway.
 *
 * The board is capped at `pageSize` rows per load. A FULL page is reported
 * explicitly (banner + a one-click date narrow) rather than passed off as the
 * complete set: an oversight surface that silently drops the oldest matching
 * orders is worse than one that admits it, because nothing on screen
 * distinguishes "300 orders" from "the newest 300 of thousands".
 */

/**
 * Status words, tones and dot colours come from the SHARED meal display layer
 * (`@/lib/format`, re-exporting the partner portal's maps) — the restaurant and
 * the admin reviewing that restaurant now read the same label for the same row,
 * and a status renamed once is renamed everywhere.
 */

/** Today as the local `YYYY-MM-DD` the delivery-date filter expects. */
function todayInput(): string {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

async function parseErrorCode(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

function friendlyError(status: number, code: string | null): string {
  switch (code) {
    case 'illegal_transition':
      return 'That status change is no longer valid for this order.';
    case 'conflict':
      return 'This order changed elsewhere. Refreshing.';
    case 'not_found':
      return 'This order no longer exists.';
    // The order has been paid for, so plain cancelling would strand the
    // customer's money. Name the action that actually handles it.
    case 'refund_required':
      return 'This order is paid. Use Cancel and refund so the money goes back.';
    case 'payment_review_required':
      return 'The payment receipt is still being checked. Decide it on the payments queue first.';
    case 'not_paid':
      return 'Nothing has been paid on this order, so there is nothing to send back. Use Mark cancelled.';
    default:
      break;
  }
  if (status === 403) return 'You are not allowed to do that.';
  return 'Something went wrong. Try again.';
}

export function OrdersOversight({
  initialOrders,
  partners,
  pageSize,
  canViewMembers,
  canReverseMoney,
}: {
  initialOrders: AdminOrderRow[];
  partners: { id: string; name: string }[];
  /** Row ceiling the server applies (ADMIN_ORDERS_PAGE_SIZE, passed down
   * because `_data.ts` is server-only and can't be value-imported here). A full
   * page means older matching orders were dropped — say so instead of showing a
   * truncated board that looks complete. */
  pageSize: number;
  /** Viewer holds `members.read`, so member names can link to the record. */
  canViewMembers: boolean;
  /** Viewer holds `payments.review` as well as `orders.review`, so the
   * cancel-and-refund action on a paid order is theirs to use. */
  canReverseMoney: boolean;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState<AdminOrderRow[]>(initialOrders);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [scope, setScope] = useState<'active' | 'history' | 'all'>('active');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  // Cancelling or refusing a live food order used to fire on a single click
  // that never said whose order it was. Both now route through a confirm that
  // names the order, the member and the money.
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  // Cancel-and-refund is its own confirmation: it is the only action here that
  // moves money, so it must never share a dialog with the ordinary cancel.
  const [pendingRefund, setPendingRefund] = useState(false);

  // Re-fetch from the guarded API whenever a server-side filter changes,
  // debouncing the free-text search box so each keystroke doesn't fire a
  // round trip (B14 — `q` is matched against the FULL table server-side, not
  // just the already-fetched page; mirrors the members directory's pattern).
  // Skip the very first render — the page already server-loaded the default
  // (scope=active, no other filters) view.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (partnerId) params.set('partnerId', partnerId);
      if (status) params.set('status', status);
      params.set('scope', scope);
      if (query.trim()) params.set('q', query.trim());
      void (async () => {
        try {
          const res = await fetch(`/api/admin/orders?${params.toString()}`, {
            credentials: 'include',
            signal: controller.signal,
          });
          if (!res.ok) {
            setLoading(false);
            return;
          }
          const data = (await res.json()) as { orders: AdminOrderRow[] };
          setOrders(data.orders);
          setLoading(false);
        } catch {
          if (controller.signal.aborted) return;
          setLoading(false);
        }
      })();
    }, query.trim() ? 300 : 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, partnerId, status, scope, query]);

  // CSV export mirrors the ACTIVE server-side filters (date/partnerId/status/
  // scope) so "download" always matches what the board is currently showing —
  // the export route (owned outside this package) has no `q` param; it's a
  // date/partner/status/scope rollup by design, not a search-result dump.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (partnerId) params.set('partnerId', partnerId);
    if (status) params.set('status', status);
    params.set('scope', scope);
    const qs = params.toString();
    return `/api/admin/exports/meal-orders${qs ? `?${qs}` : ''}`;
  }, [date, partnerId, status, scope]);

  // The server already applies `q` against the full matching set (B14); no
  // client-side re-filtering here — `orders` IS the filtered set.
  const filtered = orders;

  // A full page means the server hit its ceiling and OLDER matching orders were
  // dropped. Without this the board silently lies: 300 rows and 30,000 rows
  // render identically. Narrowing any server-side filter brings them back into
  // range, so name that explicitly.
  const truncated = !loading && orders.length >= pageSize;

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const availableTargets = useMemo<OrderStatus[]>(() => {
    if (!selected) return [];
    return ORDER_STATUSES.filter(
      (to) => to !== selected.status && canActorAdvance(selected.status, to, 'admin'),
    );
  }, [selected]);

  /**
   * Money already captured on this order. While it sits there, the ordinary
   * override rail refuses to cancel or refuse (it will not strand a customer's
   * cash), which is exactly the state the cancel-and-refund action exists for.
   */
  const paymentHeld = selected?.paymentStatus === 'paid';
  /** Receipt uploaded, nobody has decided it yet. Payments queue owns this one. */
  const paymentInReview = selected?.paymentStatus === 'receipt_submitted';

  /**
   * Targets the plain override route would actually accept. While money is held
   * or under review it rejects cancel and refuse, so offering those buttons only
   * ever produced a 409 and a confused operator.
   */
  const overrideTargets = useMemo(
    () =>
      paymentHeld || paymentInReview
        ? availableTargets.filter((t) => t !== 'cancelled' && t !== 'refused')
        : availableTargets,
    [availableTargets, paymentHeld, paymentInReview],
  );

  /**
   * The escape hatch for a paid order that has to stop: one compare-and-set that
   * cancels it AND marks the payment refunded, so the money is never stranded on
   * a dead order. It has existed and been reachable by nobody; this is its
   * button. Needs `payments.review` on top of `orders.review`, same as the route.
   */
  const canCancelAndRefund =
    paymentHeld && availableTargets.includes('cancelled') && canReverseMoney;
  const reasonRequired = overrideTargets.some(isDestructive) || canCancelAndRefund;
  const hasReason = reason.trim().length > 0;

  function openRow(row: AdminOrderRow) {
    setSelectedId(row.id);
    setReason('');
    setDrawerError(null);
    setPendingStatus(null);
    setPendingRefund(false);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
    setPendingStatus(null);
    setPendingRefund(false);
  }

  /** Only the two that take food away from a member need a confirm step. */
  function isDestructive(to: OrderStatus): boolean {
    return to === 'cancelled' || to === 'refused';
  }

  function requestOverride(to: OrderStatus) {
    if (isDestructive(to)) {
      setPendingStatus(to);
      return;
    }
    void override(to);
  }

  async function override(toStatus: OrderStatus) {
    if (!selected) return;
    setBusy(true);
    setDrawerError(null);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(selected.id)}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          toStatus,
          // B13: a refuse also carries the typed reason — the server used to
          // only persist it for 'cancelled', silently discarding what an admin
          // typed into the SAME textarea when refusing instead.
          reason:
            toStatus === 'cancelled' || toStatus === 'refused'
              ? reason.trim() || undefined
              : undefined,
        }),
      });
      if (!res.ok) {
        const code = await parseErrorCode(res);
        setDrawerError(friendlyError(res.status, code));
        setBusy(false);
        setPendingStatus(null);
        if (code === 'conflict' || code === 'not_found') {
          setSelectedId(null);
          router.refresh();
        }
        return;
      }
      setBusy(false);
      setPendingStatus(null);
      setSelectedId(null);
      router.refresh();
    } catch {
      setDrawerError('Could not reach us just now. Try again.');
      setBusy(false);
      setPendingStatus(null);
    }
  }

  /**
   * Cancel a PAID order and send the money back, in one guarded server call.
   * The reason is required by the route, is written into the order history, and
   * is relayed to the member with the cancellation, so it is never optional here
   * either — the button stays disabled until one is typed.
   */
  async function cancelAndRefund() {
    if (!selected || !hasReason) return;
    setBusy(true);
    setDrawerError(null);
    try {
      const res = await fetch(
        `/api/admin/orders/${encodeURIComponent(selected.id)}/force-cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!res.ok) {
        const code = await parseErrorCode(res);
        setDrawerError(friendlyError(res.status, code));
        setBusy(false);
        setPendingRefund(false);
        if (code === 'conflict' || code === 'not_found') {
          setSelectedId(null);
          router.refresh();
        }
        return;
      }
      setBusy(false);
      setPendingRefund(false);
      setSelectedId(null);
      router.refresh();
    } catch {
      setDrawerError('Could not reach us just now. Try again.');
      setBusy(false);
      setPendingRefund(false);
    }
  }

  const columns: Column<AdminOrderRow>[] = [
    {
      key: 'order',
      header: 'Order',
      width: 110,
      render: (r) => (
        <span
          className="gt-numeric"
          style={{ fontSize: 12, letterSpacing: '0.04em', color: 'var(--gt-text)' }}
        >
          {orderNumber(r.id)}
        </span>
      ),
    },
    {
      key: 'placed',
      header: 'Placed',
      width: 130,
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {formatShortDateTime(r.placedAt)}
        </span>
      ),
    },
    {
      key: 'partner',
      header: 'Partner',
      render: (r) => <span style={{ fontSize: 13 }}>{r.partnerName}</span>,
    },
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <MemberLink
            id={r.accountId}
            name={r.accountDisplayName}
            email={r.accountEmail}
            canView={canViewMembers}
          />
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.accountEmail}</div>
        </div>
      ),
    },
    {
      key: 'delivery',
      header: 'Delivery',
      width: 150,
      render: (r) => (
        <span style={{ fontSize: 12 }}>
          {formatDateLabel(r.deliveryDate)} · {windowShort(r.window)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 150,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: ORDER_STATUS_COLOR[r.status],
              flexShrink: 0,
            }}
          />
          <Badge tone={ORDER_STATUS_TONE[r.status]}>{ORDER_STATUS_LABEL[r.status]}</Badge>
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      width: 100,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {formatMoney(r.totalMinor, r.currency)}
        </span>
      ),
    },
  ];

  return (
    <>
      <Toolbar
        left={
          <SearchField
            placeholder="Search partner or member…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        right={
          <>
            <input
              type="date"
              className="gt-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Filter by delivery date"
            />
            <select
              className="gt-input"
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              aria-label="Filter by partner"
            >
              <option value="">All partners</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="gt-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              className="gt-input"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'active' | 'history' | 'all')}
              aria-label="Filter by scope"
            >
              <option value="active">Active</option>
              <option value="history">History</option>
              <option value="all">All</option>
            </select>
            <DownloadCsv href={exportHref} />
          </>
        }
      />

      {truncated ? (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--gt-warning) 40%, transparent)',
            background: 'color-mix(in srgb, var(--gt-warning) 10%, transparent)',
            color: 'var(--gt-text)',
            fontSize: 13,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span>
            Showing only the {pageSize} most recent orders that match these filters. Older ones
            are not on this page. Pick a delivery date, partner, status, or search a member to
            bring them into view.
          </span>
          {date ? null : (
            <Button variant="ghost" size="sm" onClick={() => setDate(todayInput())}>
              Narrow to today
            </Button>
          )}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={openRow}
        empty={loading ? 'Loading…' : 'No orders match these filters.'}
      />

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected ? `Order ${orderNumber(selected.id)}` : 'Order'}
        width={460}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={ORDER_STATUS_TONE[selected.status]}>
                {ORDER_STATUS_LABEL[selected.status]}
              </Badge>
              <Badge tone="info">{selected.source === 'subscription' ? 'Subscription' : 'One-time'}</Badge>
              <Badge tone="neutral">{windowShort(selected.window)}</Badge>
            </div>

            <Row label="Member">
              <MemberLink
                id={selected.accountId}
                name={selected.accountDisplayName}
                email={selected.accountEmail}
                canView={canViewMembers}
                strong={false}
              />
              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{selected.accountEmail}</div>
            </Row>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
              <Row label="Restaurant">{selected.partnerName}</Row>
              <Row label="Placed">{formatShortDateTime(selected.placedAt)}</Row>
              <Row label="Delivery date">{formatDateLabel(selected.deliveryDate)}</Row>
              <Row label="Delivery window">{windowLabel(selected.window)}</Row>
              <Row label="Payment method">
                {PAYMENT_LABEL[selected.paymentMethod] ?? selected.paymentMethod}
              </Row>
              <Row label="Payment status">
                {PAYMENT_STATUS_LABEL[selected.paymentStatus] ?? selected.paymentStatus}
              </Row>
              <Row label="Subtotal">{formatMoney(selected.subtotalMinor, selected.currency)}</Row>
              <Row label="Total">{formatMoney(selected.totalMinor, selected.currency)}</Row>
            </div>

            <Row label="Delivery address">
              {selected.deliveryName} · {selected.deliveryPhone}
              <div>{selected.deliveryAddressText}</div>
              {selected.deliveryNotes ? (
                <div style={{ color: 'var(--gt-text-dim)', marginTop: 4 }}>{selected.deliveryNotes}</div>
              ) : null}
              {selected.deliveryLat != null && selected.deliveryLng != null ? (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <LocationPicker
                    mode="pin"
                    value={{ lat: selected.deliveryLat, lng: selected.deliveryLng }}
                    readOnly
                    searchEnabled={false}
                    height={200}
                    ariaLabel="Delivery location"
                  />
                  <a
                    href={`https://www.google.com/maps?q=${selected.deliveryLat},${selected.deliveryLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      alignSelf: 'flex-start',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--gt-accent-strong)',
                      textDecoration: 'none',
                    }}
                  >
                    Open in Google Maps →
                  </a>
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  No map pin. Customer address is text-only.
                </div>
              )}
            </Row>

            <div>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                  marginBottom: 6,
                }}
              >
                Items
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {selected.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>
                      {it.qty}× {it.name}
                    </span>
                    <span className="gt-numeric">{formatMoney(it.priceMinorSnapshot * it.qty, selected.currency)}</span>
                  </div>
                ))}
              </div>
            </div>

            {selected.cancelReason ? <Row label="Reason">{selected.cancelReason}</Row> : null}

            <div>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                  marginBottom: 6,
                }}
              >
                History
              </div>
              <OrderTimeline orderId={selected.id} />
            </div>

            {overrideTargets.length > 0 || canCancelAndRefund ? (
              <div
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--gt-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {reasonRequired ? (
                  <textarea
                    className="gt-input"
                    placeholder="Reason (shown in the order history and sent to the member)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    disabled={busy}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  />
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {overrideTargets.map((to) => (
                    <Button
                      key={to}
                      variant={isDestructive(to) ? 'danger' : 'primary'}
                      size="sm"
                      disabled={busy}
                      onClick={() => requestOverride(to)}
                    >
                      {busy ? 'Working…' : `Mark ${ORDER_STATUS_LABEL[to].toLowerCase()}`}
                    </Button>
                  ))}
                  {canCancelAndRefund ? (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busy || !hasReason}
                      title={
                        hasReason
                          ? undefined
                          : 'Type a reason first. The member is told why their order stopped.'
                      }
                      onClick={() => setPendingRefund(true)}
                    >
                      {busy ? 'Working…' : 'Cancel and refund'}
                    </Button>
                  ) : null}
                </div>
                {canCancelAndRefund && !hasReason ? (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--gt-text-dim)' }}>
                    Type a reason to cancel and refund. The member is told why.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Money-held states: say why cancel is missing, and where it lives. */}
            {paymentInReview && availableTargets.includes('cancelled') ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                This order&apos;s payment receipt is still being checked. Decide it on the payments
                queue, then come back and cancel.
              </div>
            ) : null}
            {paymentHeld && availableTargets.includes('cancelled') && !canReverseMoney ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                This order is paid, so stopping it means sending{' '}
                {formatMoney(selected.totalMinor, selected.currency)} back. That takes someone who
                can review payments.
              </div>
            ) : null}
            {availableTargets.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                This order is finished. Nothing left to change.
              </div>
            ) : null}

            {drawerError ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{drawerError}</div> : null}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={selected != null && pendingStatus != null}
        title={pendingStatus === 'refused' ? 'Refuse this order?' : 'Cancel this order?'}
        summary={
          selected && pendingStatus ? (
            <>
              {pendingStatus === 'refused' ? 'Refusing' : 'Cancelling'} order{' '}
              {orderNumber(selected.id)} stops the delivery for{' '}
              <strong>{selected.accountDisplayName || selected.accountEmail}</strong> and tells them
              why. It cannot be undone.
            </>
          ) : (
            ''
          )
        }
        details={
          selected
            ? [
                { label: 'Member', value: selected.accountDisplayName || selected.accountEmail },
                { label: 'Restaurant', value: selected.partnerName },
                {
                  label: 'Delivery',
                  value: `${formatDateLabel(selected.deliveryDate)} · ${windowShort(selected.window)}`,
                },
                {
                  label: 'Order total',
                  value: (
                    <span className="gt-numeric">
                      {formatMoney(selected.totalMinor, selected.currency)}
                    </span>
                  ),
                },
              ]
            : undefined
        }
        confirmLabel={pendingStatus === 'refused' ? 'Refuse order' : 'Cancel order'}
        busyLabel="Working…"
        cancelLabel="Keep this order"
        busy={busy}
        onCancel={() => setPendingStatus(null)}
        onConfirm={() => {
          if (pendingStatus) void override(pendingStatus);
        }}
      >
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)' }}>
          {reason.trim()
            ? `Reason shown to the member: “${reason.trim()}”`
            : 'No reason typed. Close this and add one if the member should know why.'}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={selected != null && pendingRefund}
        title="Cancel this order and send the money back?"
        summary={
          selected ? (
            <>
              Order {orderNumber(selected.id)} stops, and the{' '}
              <strong>{formatMoney(selected.totalMinor, selected.currency)}</strong>{' '}
              {selected.accountDisplayName || selected.accountEmail} paid is returned. They are told
              why. It cannot be undone.
            </>
          ) : (
            ''
          )
        }
        details={
          selected
            ? [
                { label: 'Member', value: selected.accountDisplayName || selected.accountEmail },
                { label: 'Restaurant', value: selected.partnerName },
                {
                  label: 'Delivery',
                  value: `${formatDateLabel(selected.deliveryDate)} · ${windowShort(selected.window)}`,
                },
                {
                  label: 'Paid with',
                  value: PAYMENT_LABEL[selected.paymentMethod] ?? selected.paymentMethod,
                },
                {
                  label: 'Amount returned',
                  value: (
                    <span className="gt-numeric">
                      {formatMoney(selected.totalMinor, selected.currency)}
                    </span>
                  ),
                },
              ]
            : undefined
        }
        confirmLabel="Cancel and refund"
        busyLabel="Working…"
        cancelLabel="Keep this order"
        busy={busy}
        onCancel={() => setPendingRefund(false)}
        onConfirm={() => void cancelAndRefund()}
      >
        {reason.trim() ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Reason shown to the member: “{reason.trim()}”
          </p>
        ) : null}
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-dim)' }}>
          {selected?.paymentMethod === 'cod'
            ? 'Cash was collected at the door, so the restaurant hands it back. Marking it here records that and closes the order.'
            : 'The order is marked refunded here. Moving the money itself is still done by hand, the same way every other refund is.'}
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
