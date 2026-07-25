'use client';

import {
  canActorAdvance,
  ORDER_STATUSES,
  orderNumber,
  partnerCanRefuse,
  partnerRefuseTarget,
  type MealWindow,
  type OrderStatus,
} from '@gym/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, EmptyState } from '@/components/console';
import type { PartnerOrderView } from '../_data';
import {
  formatDateLabel,
  formatMoney,
  isOrderLate,
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  windowShort,
} from '../_format';
import { OrderDetailDrawer } from './OrderDetailDrawer';
import { RefuseControl } from './RefuseControl';
import { useCallbackRef } from './useCallbackRef';
import styles from './board.module.css';

/**
 * The Today board — the partner's live operations surface. Every non-terminal
 * order for the current KTM day, split into a lunch and a dinner lane, each a
 * kanban of the fulfillment columns (Pending → Confirmed → Preparing → Out for
 * delivery). One-tap advance is optimistic and self-heals on a CAS conflict
 * (409 → refetch). The board polls every 15s, badges orders that arrived since
 * this page opened, and highlights any order whose delivery window has already
 * started but isn't delivered.
 *
 * The bell (sound, the tab title, the "you have unseen orders" count) is NOT
 * here: it lives in PartnerAlerts, mounted by the layout, so it keeps watch on
 * every page of the portal instead of only this one. Two owners would have
 * meant two chimes for one order, and no chime at all while the partner was on
 * the menu or earnings page — which is where a kitchen usually is.
 *
 * Visual language (2026-07-21 professional pass): a live-pill toolbar,
 * per-status column dots and card edge strips (amber → blue → orange, red for
 * late/overdue), GM-order numbers on every card, and lane headers that carry
 * both the order count and the money at stake.
 */

const POLL_MS = 15_000;

/** Board columns, left→right, matching the natural fulfillment flow. */
const COLUMNS: { status: OrderStatus; label: string }[] = [
  { status: 'pending', label: 'Awaiting confirmation' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'preparing', label: 'Preparing' },
  { status: 'out_for_delivery', label: 'Out for delivery' },
];

const ADVANCE_META: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Confirm',
  preparing: 'Start preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Mark delivered',
};

/** Partner-reachable forward targets for a status (excludes cancel/refuse). */
function nextAction(from: OrderStatus): OrderStatus | null {
  const to = ORDER_STATUSES.find(
    (t) => t !== 'cancelled' && t !== 'refused' && canActorAdvance(from, t, 'partner') && ADVANCE_META[t],
  );
  return to ?? null;
}

export function TodayBoard({
  orders: initial,
  today,
  currency,
}: {
  orders: PartnerOrderView[];
  today: string;
  currency: string;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState<PartnerOrderView[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pollFailed, setPollFailed] = useState(false);

  const knownIds = useRef<Set<string>>(new Set(initial.map((o) => o.orderId)));

  const todaysOrders = useMemo(
    () => orders.filter((o) => o.deliveryDate === today),
    [orders, today],
  );

  // Non-terminal orders whose delivery date is strictly in the PAST — one-time
  // orders that slipped past their date are otherwise permanently invisible
  // (P0-12). `loadActiveOrders` returns non-terminal orders regardless of date
  // (contract C-E), including subscription orders materialized for TOMORROW; a
  // `!== today` test would wrongly flag those on-schedule future deliveries as
  // overdue, so match only dates strictly before today. Future orders that
  // aren't today yet simply wait to appear in today's board when they come due.
  const overdueOrders = useMemo(
    () => orders.filter((o) => o.deliveryDate < today),
    [orders, today],
  );

  // Late-highlight recompute every 30s without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // 15s polling — the board redraws from the source of truth and detects
  // newly-arrived ids. `materialize=skip` keeps the poll a pure read: the page
  // already spawned any due subscription deliveries when it loaded, so having
  // every open kitchen re-drive that write pass four times a minute only piles
  // work on the database.
  const poll = useCallbackRef(async () => {
    try {
      const res = await fetch('/api/partner/orders?scope=active&materialize=skip', {
        credentials: 'include',
      });
      if (!res.ok) {
        setPollFailed(true);
        return;
      }
      const body = (await res.json()) as { orders: PartnerOrderView[] };
      const fetched = body.orders;
      const fresh = fetched.filter(
        (o) => o.deliveryDate === today && !knownIds.current.has(o.orderId),
      );
      if (fresh.length > 0) {
        setNewIds((prev) => {
          const next = new Set(prev);
          for (const o of fresh) next.add(o.orderId);
          return next;
        });
      }
      for (const o of fetched) knownIds.current.add(o.orderId);
      setOrders(fetched);
      setPollFailed(false);
    } catch {
      // Transient (offline / server hiccup) — flag it so the kitchen knows the
      // board may be stale; the next tick retries and clears the flag.
      setPollFailed(true);
    }
  });

  useEffect(() => {
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  async function advance(orderId: string, toStatus: OrderStatus, reason?: string) {
    setBusyId(orderId);
    setErrorById((e) => ({ ...e, [orderId]: '' }));
    try {
      const res = await fetch(`/api/partner/orders/${encodeURIComponent(orderId)}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(reason ? { toStatus, reason } : { toStatus }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          body.error === 'payment_required'
            ? 'Not paid yet. Approve the payment before confirming.'
            : body.error === 'conflict' || body.error === 'illegal_transition'
              ? 'This order changed. Refreshing.'
              : 'Could not update. Try again.';
        setErrorById((e) => ({ ...e, [orderId]: msg }));
        if (body.error === 'conflict' || body.error === 'illegal_transition') void poll();
        return;
      }
      const body = (await res.json()) as { order: PartnerOrderView };
      setOrders((list) => list.map((o) => (o.orderId === orderId ? body.order : o)));
      router.refresh();
    } catch {
      setErrorById((e) => ({ ...e, [orderId]: 'Could not reach us just now. Try again.' }));
    } finally {
      setBusyId(null);
    }
  }

  function acknowledgeNew() {
    setNewIds(new Set());
  }

  const windows: MealWindow[] = ['lunch', 'dinner'];
  const hasToday = todaysOrders.length > 0;
  const hasOverdue = overdueOrders.length > 0;

  return (
    <div>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={`${styles.livePill} ${pollFailed ? styles.livePillPaused : ''}`}>
            <span className="gt-live-dot" aria-hidden />
            {pollFailed
              ? 'Live updates paused, retrying'
              : `Live · every 15s · ${todaysOrders.length} today`}
          </span>
          {newIds.size > 0 ? (
            <button onClick={acknowledgeNew} className={styles.newOrdersBtn}>
              {newIds.size} arrived since you opened this page · clear
            </button>
          ) : null}
        </div>
      </div>

      {hasOverdue ? (
        <OverdueLane
          orders={overdueOrders}
          currency={currency}
          nowMs={nowMs}
          busyId={busyId}
          errorById={errorById}
          onAdvance={advance}
          onOpen={setSelectedId}
        />
      ) : null}

      {!hasToday ? (
        hasOverdue ? null : (
          <EmptyState
            title="No orders for today yet"
            description="New one-time and subscription orders for today appear here automatically."
          />
        )
      ) : (
        <div className={styles.laneStack}>
          {windows.map((window) => {
            const windowOrders = todaysOrders.filter((o) => o.window === window);
            if (windowOrders.length === 0) return null;
            return (
              <WindowLane
                key={window}
                window={window}
                orders={windowOrders}
                currency={currency}
                nowMs={nowMs}
                busyId={busyId}
                errorById={errorById}
                newIds={newIds}
                onAdvance={advance}
                onOpen={setSelectedId}
              />
            );
          })}
        </div>
      )}

      {selectedId ? (
        <OrderDetailDrawer
          orderId={selectedId}
          currency={currency}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Needs-attention lane: non-terminal orders whose delivery date is no longer
 * today (P0-12). Rendered as a flat responsive grid rather than a kanban since
 * these orders can sit in any live status. Each card shows its (past) delivery
 * date and offers the same advance / mark-refused actions so the partner can
 * clear the backlog.
 */
function OverdueLane({
  orders,
  currency,
  nowMs,
  busyId,
  errorById,
  onAdvance,
  onOpen,
}: {
  orders: PartnerOrderView[];
  currency: string;
  nowMs: number;
  busyId: string | null;
  errorById: Record<string, string>;
  onAdvance: (id: string, to: OrderStatus, reason?: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section aria-label="Overdue orders needing attention" className={styles.overdueLane}>
      <div className={styles.overdueHeader}>
        <h3 className={styles.overdueTitle}>Needs attention</h3>
        <Badge tone="critical">{orders.length} overdue</Badge>
      </div>
      <p className={styles.overdueCopy}>
        Open orders past their delivery date. Complete or mark each refused to clear it.
      </p>
      <div className={styles.overdueGrid}>
        {orders.map((o) => (
          <BoardCard
            key={o.orderId}
            order={o}
            currency={currency}
            late={isOrderLate(o, nowMs)}
            isNew={false}
            busy={busyId === o.orderId}
            error={errorById[o.orderId]}
            showDate
            onAdvance={onAdvance}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function WindowLane({
  window,
  orders,
  currency,
  nowMs,
  busyId,
  errorById,
  newIds,
  onAdvance,
  onOpen,
}: {
  window: MealWindow;
  orders: PartnerOrderView[];
  currency: string;
  nowMs: number;
  busyId: string | null;
  errorById: Record<string, string>;
  newIds: Set<string>;
  onAdvance: (id: string, to: OrderStatus, reason?: string) => void;
  onOpen: (id: string) => void;
}) {
  const lateCount = orders.filter((o) => isOrderLate(o, nowMs)).length;
  const laneTotalMinor = orders.reduce((sum, o) => sum + o.totalMinor, 0);
  return (
    <section aria-label={`${windowShort(window)} orders`}>
      <div className={styles.laneHeader}>
        <h3 className={styles.laneTitle}>{windowShort(window)}</h3>
        <span className={styles.laneMeta}>
          {orders.length} {orders.length === 1 ? 'order' : 'orders'} ·{' '}
          <span className="gt-numeric">{formatMoney(laneTotalMinor, currency)}</span>
        </span>
        {lateCount > 0 ? <Badge tone="critical">{lateCount} late</Badge> : null}
      </div>

      <div className={styles.laneScroll}>
        <div className={styles.laneColumns}>
          {COLUMNS.map((col) => {
            const colOrders = orders.filter((o) => o.status === col.status);
            return (
              <div key={col.status} className={styles.column}>
                <div className={styles.columnHeader}>
                  <span className={styles.columnLabel}>
                    <span
                      className={styles.columnDot}
                      style={{ background: ORDER_STATUS_COLOR[col.status] }}
                      aria-hidden
                    />
                    {col.label}
                  </span>
                  <span className={styles.columnCount}>{colOrders.length}</span>
                </div>
                <div className={styles.columnBody}>
                  {colOrders.map((o) => (
                    <BoardCard
                      key={o.orderId}
                      order={o}
                      currency={currency}
                      late={isOrderLate(o, nowMs)}
                      isNew={newIds.has(o.orderId)}
                      busy={busyId === o.orderId}
                      error={errorById[o.orderId]}
                      onAdvance={onAdvance}
                      onOpen={onOpen}
                    />
                  ))}
                  {colOrders.length === 0 ? (
                    <div className={styles.columnEmpty}>No orders</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BoardCard({
  order,
  currency,
  late,
  isNew,
  busy,
  error,
  showDate,
  onAdvance,
  onOpen,
}: {
  order: PartnerOrderView;
  currency: string;
  late: boolean;
  isNew: boolean;
  busy: boolean;
  error?: string;
  showDate?: boolean;
  onAdvance: (id: string, to: OrderStatus, reason?: string) => void;
  onOpen: (id: string) => void;
}) {
  const to = nextAction(order.status);
  const refuseTarget = partnerCanRefuse(order.status) ? partnerRefuseTarget(order.status) : null;
  const digitalUnpaid =
    order.paymentMethod !== 'cod' &&
    order.paymentStatus !== 'paid' &&
    order.paymentStatus !== 'refunded';
  const blocked = to === 'confirmed' && digitalUnpaid;
  const itemCount = order.items.reduce((sum, it) => sum + it.qty, 0);
  const stripColor = late ? 'var(--gt-danger)' : ORDER_STATUS_COLOR[order.status];

  return (
    <div
      className={`gt-card ${styles.orderCard} ${isNew ? styles.orderCardNew : ''}`}
      style={{ borderLeftColor: stripColor }}
    >
      <button onClick={() => onOpen(order.orderId)} className={styles.orderCardOpen} aria-label={`Open order for ${order.deliveryName}`}>
        <span className={`${styles.orderNumber} ${showDate ? styles.orderNumberOverdue : ''}`}>
          {orderNumber(order.orderId)}
          {showDate ? ` · ${formatDateLabel(order.deliveryDate)} · ${windowShort(order.window)}` : ''}
        </span>
        <div className={styles.orderNameRow}>
          <strong className={styles.orderName}>{order.deliveryName}</strong>
          <span className={styles.orderTotal}>{formatMoney(order.totalMinor, currency)}</span>
        </div>
        {order.deliveryAddressText ? (
          <div className={styles.orderAddress} title={order.deliveryAddressText}>
            <span aria-hidden="true">📍</span> {order.deliveryAddressText}
          </div>
        ) : null}
        <div className={styles.orderItems}>
          {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
          {order.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
        </div>
        <div className={styles.badgeRow}>
          {late ? <Badge tone="critical">Late</Badge> : null}
          {isNew ? <Badge tone="info">New</Badge> : null}
          {digitalUnpaid ? <Badge tone="warning">Unpaid</Badge> : null}
          {order.status === 'out_for_delivery' ? (
            <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
          ) : null}
        </div>
      </button>

      {to ? (
        <Button
          variant="primary"
          size="sm"
          disabled={busy || blocked}
          title={blocked ? 'Payment must be approved before confirming.' : undefined}
          onClick={() => onAdvance(order.orderId, to)}
          style={{ width: '100%', textAlign: 'center' }}
        >
          {busy ? 'Working…' : ADVANCE_META[to]}
        </Button>
      ) : null}

      {refuseTarget ? (
        <RefuseControl
          label={refuseTarget === 'refused' ? 'Mark refused' : 'Reject order'}
          busy={busy}
          onConfirm={(reason) => onAdvance(order.orderId, refuseTarget, reason)}
        />
      ) : null}

      {error ? <div className={styles.cardError}>{error}</div> : null}
    </div>
  );
}
