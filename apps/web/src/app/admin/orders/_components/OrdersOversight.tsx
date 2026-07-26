'use client';

import {
  ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  canActorAdvance,
  orderNumber,
  type OrderStatus,
} from '@gym/shared';
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
  SkeletonRows,
  Toolbar,
} from '@/components/console';
import {
  formatAge,
  formatDateLabel,
  formatMoney,
  formatShortDateTime,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_LABEL,
  PAYMENT_STATUS_LABEL,
  windowLabel,
  windowShort,
} from '@/lib/format';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { DownloadCsv } from '../../_components/DownloadCsv';
import { KeyboardRows } from '../../_components/KeyboardRows';
import { MemberLink } from '../../_components/MemberLink';
import { QueueTabs } from '../../_components/QueueTabs';
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
 * Status words and tones come from the SHARED meal display layer
 * (`@/lib/format`, re-exporting the partner portal's maps) — the restaurant and
 * the admin reviewing that restaurant now read the same label for the same row,
 * and a status renamed once is renamed everywhere.
 *
 * ONE status treatment per row: the toned Badge. The cell used to pair it with a
 * coloured dot drawn from a second palette (ORDER_STATUS_COLOR), so every row
 * stated its status twice in two colour systems that answer to nobody — a
 * palette drifting apart from the tones is a status that looks like two
 * different things at once.
 */

/** Today as the local `YYYY-MM-DD` the delivery-date filter expects. */
function todayInput(): string {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const TERMINAL = new Set<OrderStatus>(TERMINAL_ORDER_STATUSES);

/** The one filter that changes what this board is FOR: a live queue, or a
 * record. Named for the work rather than for the query parameter. */
type Scope = 'active' | 'history' | 'all';
const SCOPES: readonly { key: Scope; label: string }[] = [
  { key: 'active', label: 'Still moving' },
  { key: 'history', label: 'Finished' },
  { key: 'all', label: 'Everything' },
];

/**
 * The one thing an operator is scanning this board for: an order whose delivery
 * day has been and gone while the order is still moving. Nobody is coming to
 * fix that on their own. It reads off the two fields the row already carries —
 * no extra lookup, no change to what is fetched — and the date strings are
 * `YYYY-MM-DD`, so a plain comparison is also a chronological one.
 */
function isLate(row: AdminOrderRow, today: string): boolean {
  return !TERMINAL.has(row.status) && row.deliveryDate < today;
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
  const [scope, setScope] = useState<Scope>('active');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Which target is actually in flight, so only the button that was pressed
  // says "Working…" instead of every button in the row claiming to be busy.
  const [busyTarget, setBusyTarget] = useState<OrderStatus | null>(null);
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

  // Read on every render, so a board left open across midnight starts calling
  // yesterday's undelivered orders late without needing a reload.
  const today = todayInput();
  const lateCount = useMemo(
    () => orders.filter((o) => isLate(o, today)).length,
    [orders, today],
  );

  const narrowed = Boolean(date || partnerId || status || query.trim());

  function clearFilters() {
    setDate('');
    setPartnerId('');
    setStatus('');
    setQuery('');
  }

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

  /** The natural next step in the lifecycle — the single action this panel is
   * really offering, and the only one that earns the accent. */
  const nextStep = overrideTargets.find((t) => !isDestructive(t)) ?? null;

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
    setBusyTarget(toStatus);
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
        setBusyTarget(null);
        setPendingStatus(null);
        if (code === 'conflict' || code === 'not_found') {
          setSelectedId(null);
          router.refresh();
        }
        return;
      }
      setBusy(false);
      setBusyTarget(null);
      setPendingStatus(null);
      setSelectedId(null);
      router.refresh();
    } catch {
      setDrawerError('Could not reach us just now. Try again.');
      setBusy(false);
      setBusyTarget(null);
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
    // Primary column. Every cell on this board used to be 12-13px dim text, so
    // there was nothing to scan down and nothing to say what a row IS — the
    // order number, the one thing an operator quotes back to a member or a
    // restaurant, was the quietest thing in the row. It carries the row now:
    // full ink, larger, with the restaurant beneath it as the supporting line.
    {
      key: 'order',
      header: 'Order',
      width: 180,
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
            {orderNumber(r.id)}
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
            id={r.accountId}
            name={r.accountDisplayName}
            email={r.accountEmail}
            canView={canViewMembers}
          />
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.accountEmail}</div>
        </div>
      ),
    },
    // Delivery slot, not a date stamp: the day on top, the hours the member is
    // actually expecting food underneath. When that day has passed and the
    // order is still moving, the cell says so — that is the whole reason
    // somebody is scanning this board.
    {
      key: 'delivery',
      header: 'Delivery',
      width: 180,
      render: (r) => {
        const late = isLate(r, today);
        return (
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: late ? 600 : undefined,
                color: late ? 'var(--gt-danger)' : 'var(--gt-text)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {formatDateLabel(r.deliveryDate)}
              {late ? <Badge tone="critical">Overdue</Badge> : null}
            </div>
            <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{windowLabel(r.window)}</div>
          </div>
        );
      },
    },
    // How long this has been sitting there. The exact stamp stays one hover
    // away; the number an operator triages on is the age.
    {
      key: 'age',
      header: 'Age',
      width: 80,
      align: 'right',
      render: (r) => (
        <span
          className="gt-numeric"
          style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
          title={`Placed ${formatShortDateTime(r.placedAt)}`}
        >
          {formatAge(r.placedAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 150,
      render: (r) => (
        <Badge tone={ORDER_STATUS_TONE[r.status]}>{ORDER_STATUS_LABEL[r.status]}</Badge>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      width: 110,
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
      {/* The one filter that changes what this board is FOR — a live queue or
          a record — leads, as a segmented control rather than a fourth
          identical dropdown lost in a row of five. */}
      <Toolbar
        left={
          <QueueTabs label="Which orders to show" tabs={SCOPES} value={scope} onChange={setScope} />
        }
        right={
          <>
            <span
              role="status"
              aria-live="polite"
              style={{
                fontSize: 13,
                color: 'var(--gt-text-dim)',
                minWidth: 68,
                textAlign: 'right',
              }}
            >
              {loading ? 'Updating…' : ''}
            </span>
            <DownloadCsv href={exportHref} />
          </>
        }
      />

      {/* Refinements stay quiet: labelled, on one calm surface, with a way out
          of them that only appears once there is something to clear. */}
      <div
        className="gt-card"
        style={{
          padding: 12,
          marginBottom: 16,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <Field label="Search" grow>
          <SearchField
            placeholder="Restaurant or member"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label="Delivery date">
          <input
            type="date"
            className="gt-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Filter by delivery date"
          />
        </Field>
        <Field label="Restaurant">
          <select
            className="gt-input"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            aria-label="Filter by restaurant"
          >
            <option value="">Every restaurant</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="gt-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
            aria-label="Filter by status"
          >
            <option value="">Every status</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        {narrowed ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        ) : null}
      </div>

      {/* Overdue orders are the only thing on this page nobody else will pick
          up, so the board counts them out loud instead of leaving them to be
          found by reading every row. */}
      {lateCount > 0 ? (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
            background: 'var(--gt-danger-weak)',
            color: 'var(--gt-text)',
            fontSize: 13,
          }}
        >
          <strong style={{ fontFamily: 'var(--font-heading)' }}>
            {lateCount} order{lateCount === 1 ? '' : 's'} past the delivery day
          </strong>{' '}
          and still moving. They are marked overdue below.
        </div>
      ) : null}

      {truncated ? (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid color-mix(in srgb, var(--gt-warning) 40%, transparent)',
            background: 'var(--gt-warning-weak)',
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
            are not on this page. Pick a delivery date, restaurant, status, or search a member to
            bring them into view.
          </span>
          {date ? null : (
            <Button variant="ghost" size="sm" onClick={() => setDate(todayInput())}>
              Narrow to today
            </Button>
          )}
        </div>
      ) : null}

      {/* Waiting on the first rows for these filters: a table-shaped skeleton,
          not one grey word where a board should be. Once there ARE rows the
          table stays put through a re-fetch — swapping a full board for
          placeholders on every keystroke would be its own kind of flicker. */}
      {loading && filtered.length === 0 ? (
        <SkeletonRows rows={6} cols={columns.length} />
      ) : (
        <KeyboardRows>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={openRow}
          rowAriaLabel={(r) =>
            `Open order ${orderNumber(r.id)} from ${r.partnerName} for ${
              r.accountDisplayName || r.accountEmail
            }`
          }
          empty={
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                padding: '20px 0',
              }}
            >
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 15 }}>
                {narrowed ? 'Nothing matches these filters' : 'No orders here'}
              </span>
              <span style={{ color: 'var(--gt-text-dim)', maxWidth: '44ch' }}>
                {narrowed
                  ? 'Widen the date, restaurant or status, or clear them and start again.'
                  : scope === 'active'
                    ? 'Every order has been delivered, cancelled or refused. Switch to Finished to see the record.'
                    : 'Orders appear here as members place them.'}
              </span>
              {narrowed ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          }
        />
        </KeyboardRows>
      )}

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
              <Row label="Placed">
                {formatShortDateTime(selected.placedAt)}
                <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  {formatAge(selected.placedAt)} ago
                </div>
              </Row>
              <Row label="Delivery date">
                {formatDateLabel(selected.deliveryDate)}
                {isLate(selected, today) ? (
                  <div style={{ marginTop: 4 }}>
                    <Badge tone="critical">Overdue</Badge>
                  </div>
                ) : null}
              </Row>
              <Row label="Delivery window">{windowLabel(selected.window)}</Row>
              <Row label="Payment method">
                {PAYMENT_LABEL[selected.paymentMethod] ?? selected.paymentMethod}
              </Row>
              <Row label="Payment status">
                {PAYMENT_STATUS_LABEL[selected.paymentStatus] ?? selected.paymentStatus}
              </Row>
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
                      fontFamily: 'var(--font-heading)',
                      color: 'var(--gt-text)',
                      textDecoration: 'underline',
                      textUnderlineOffset: 3,
                    }}
                  >
                    Open in Google Maps
                  </a>
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  No map pin. Customer address is text-only.
                </div>
              )}
            </Row>

            {/* One receipt, so the amounts add up on screen. The drawer used to
                print Subtotal and Total two cells apart in the facts grid, with
                the fees between them shown nowhere — a gap an operator deciding
                a refund had to take on trust. */}
            <div
              style={{
                border: '1px solid var(--gt-border)',
                borderRadius: 'var(--gt-radius-sm)',
                background: 'var(--gt-surface-sunken)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--gt-border)',
                }}
              >
                Items
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
                {selected.items.length === 0 ? (
                  <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                    Nothing was recorded against this order.
                  </span>
                ) : (
                  selected.items.map((it, i) => (
                    <MoneyLine
                      key={i}
                      label={`${it.qty}× ${it.name}`}
                      value={formatMoney(it.priceMinorSnapshot * it.qty, selected.currency)}
                    />
                  ))
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: 12,
                  borderTop: '1px solid var(--gt-border)',
                }}
              >
                <MoneyLine
                  label="Subtotal"
                  value={formatMoney(selected.subtotalMinor, selected.currency)}
                />
                <MoneyLine
                  label="Delivery fee"
                  value={formatMoney(selected.deliveryFeeMinor, selected.currency)}
                />
                {selected.smallOrderFeeMinor > 0 ? (
                  <MoneyLine
                    label="Small order fee"
                    value={formatMoney(selected.smallOrderFeeMinor, selected.currency)}
                  />
                ) : null}
                <div style={{ height: 1, background: 'var(--gt-border)', margin: '2px 0' }} />
                <MoneyLine
                  label="Total"
                  value={formatMoney(selected.totalMinor, selected.currency)}
                  strong
                />
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
                  {/* One accent in this panel. `overrideTargets` keeps lifecycle
                      order, so the first non-destructive target IS the next
                      step — that one gets the accent and every other jump stays
                      quiet, instead of three equally-loud orange buttons asking
                      the operator to work out which one they meant. */}
                  {overrideTargets.map((to) => (
                    <Button
                      key={to}
                      variant={isDestructive(to) ? 'danger' : to === nextStep ? 'primary' : 'ghost'}
                      size="sm"
                      disabled={busy}
                      onClick={() => requestOverride(to)}
                    >
                      {busy && busyTarget === to
                        ? 'Working…'
                        : `Mark ${ORDER_STATUS_LABEL[to].toLowerCase()}`}
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

/** A named filter control. Every control in the bar says what it narrows,
 * instead of leaving its purpose to a placeholder or an aria-label nobody
 * sees. */
function Field({
  label,
  grow = false,
  children,
}: {
  label: string;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: grow ? 220 : 160,
        flex: grow ? '1 1 220px' : '0 0 auto',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 12,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-dim)',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

/** One money line in the drawer's receipt: label left, tabular amount right,
 * currency always attached. */
function MoneyLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <span style={{ color: strong ? 'var(--gt-text)' : 'var(--gt-text-dim)' }}>{label}</span>
      <span
        className="gt-numeric"
        style={{ fontSize: strong ? 15 : 13, color: 'var(--gt-text)' }}
      >
        {value}
      </span>
    </div>
  );
}
