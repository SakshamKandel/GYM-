'use client';

import {
  canActorAdvance,
  ORDER_STATUSES,
  orderNumber,
  partnerCanRefuse,
  partnerRefuseTarget,
  type OrderStatus,
} from '@gym/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState } from '@/components/console';
import type { PartnerOrderView } from '../_data';
import {
  formatDateLabel,
  formatMoney,
  isOrderLate,
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_LABEL,
  windowLabel,
} from '../_format';
import { RefuseControl } from './RefuseControl';
import styles from './board.module.css';

/**
 * The partner fulfillment queue (Today's Orders + Subscriptions fulfillment).
 * Each card is one order in the STRICT partner projection — delivery-necessary
 * fields only, never member identity. Advance buttons are derived from
 * `canActorAdvance(from, to, 'partner')` so the UI can never offer an illegal or
 * unauthorized transition; the server re-validates every one via CAS.
 *
 * Visual language (2026-07-21 professional pass): status-colored edge strips,
 * GM-order numbers, and a two-column delivery/items layout shared with the
 * Today board's card vocabulary.
 */

/** Per-transition button copy + emphasis (partner-reachable transitions only). */
const ADVANCE_META: Partial<Record<OrderStatus, { label: string; variant: 'primary' | 'ghost' }>> = {
  confirmed: { label: 'Confirm order', variant: 'primary' },
  preparing: { label: 'Start preparing', variant: 'primary' },
  out_for_delivery: { label: 'Out for delivery', variant: 'primary' },
  delivered: { label: 'Mark delivered', variant: 'primary' },
};

/** Forward advance targets only — refuse/reject is handled by RefuseControl (B6). */
function advanceTargets(from: OrderStatus): OrderStatus[] {
  return ORDER_STATUSES.filter(
    (to) =>
      to !== 'cancelled' &&
      to !== 'refused' &&
      canActorAdvance(from, to, 'partner') &&
      ADVANCE_META[to],
  );
}

export function OrdersQueue({
  orders: initial,
  emptyTitle,
  emptyDescription,
}: {
  orders: PartnerOrderView[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState<PartnerOrderView[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Recompute late-highlighting periodically without re-fetching, so an order
  // whose delivery window opens while the page is open turns red on its own.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

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
            ? 'This order is not paid yet — the payment must be approved before confirming.'
            : body.error === 'conflict' || body.error === 'illegal_transition'
              ? 'This order changed since you loaded it — refreshing.'
              : 'Could not update this order. Try again.';
        setErrorById((e) => ({ ...e, [orderId]: msg }));
        if (body.error === 'conflict' || body.error === 'illegal_transition') router.refresh();
        return;
      }
      const body = (await res.json()) as { order: PartnerOrderView };
      setOrders((list) => list.map((o) => (o.orderId === orderId ? body.order : o)));
      router.refresh();
    } catch {
      setErrorById((e) => ({ ...e, [orderId]: 'Network error. Try again.' }));
    } finally {
      setBusyId(null);
    }
  }

  const visible = useMemo(() => orders, [orders]);

  if (visible.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={styles.queueStack}>
      {visible.map((o) => {
        const targets = advanceTargets(o.status);
        const refuseTarget = partnerCanRefuse(o.status) ? partnerRefuseTarget(o.status) : null;
        const digitalUnpaid =
          o.paymentMethod !== 'cod' && o.paymentStatus !== 'paid' && o.paymentStatus !== 'refunded';
        const busy = busyId === o.orderId;
        const err = errorById[o.orderId];
        const late = isOrderLate(o, nowMs);
        const stripColor = late ? 'var(--gt-danger)' : ORDER_STATUS_COLOR[o.status];

        return (
          <div key={o.orderId} className={`gt-card ${styles.queueCard}`} style={{ borderLeftColor: stripColor }}>
            <div className={styles.queueTopRow}>
              <div className={styles.queueTitleGroup}>
                <span className={styles.orderNumber}>{orderNumber(o.orderId)}</span>
                <strong className={styles.queueDate}>{formatDateLabel(o.deliveryDate)}</strong>
                <span className={styles.queueWindow}>{windowLabel(o.window)}</span>
                {late ? <Badge tone="critical">Late</Badge> : null}
              </div>
              <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
            </div>

            <div className={styles.queueGrid}>
              <div>
                <div className={styles.fieldLabel}>Deliver to</div>
                <div style={{ fontSize: 15 }}>{o.deliveryName}</div>
                <div style={{ fontSize: 14, color: 'var(--gt-text-dim)' }}>{o.deliveryPhone}</div>
                <div style={{ fontSize: 14, color: 'var(--gt-text-dim)', marginTop: 2 }}>
                  {o.deliveryAddressText}
                </div>
                {o.deliveryNotes ? (
                  <div style={{ fontSize: 13, color: 'var(--gt-text-faint)', marginTop: 4 }}>
                    Note: {o.deliveryNotes}
                  </div>
                ) : null}
              </div>

              <div>
                <div className={styles.fieldLabel}>Items</div>
                <ul className={styles.queueItems}>
                  {o.items.map((it, i) => (
                    <li key={`${o.orderId}-${i}`} className={styles.queueItemLine}>
                      <span>
                        {it.qty}× {it.name}
                      </span>
                      <span className={styles.queueItemPrice}>
                        {formatMoney(it.priceMinorSnapshot * it.qty, o.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={styles.queueTotalRow}>
                  <strong>Total</strong>
                  <strong className={styles.queueTotalValue}>{formatMoney(o.totalMinor, o.currency)}</strong>
                </div>
                <div className={styles.queuePayMeta}>
                  {PAYMENT_LABEL[o.paymentMethod] ?? o.paymentMethod}
                  {digitalUnpaid ? ' · awaiting payment' : o.paymentStatus === 'paid' ? ' · paid' : ''}
                </div>
              </div>
            </div>

            {(targets.length > 0 || refuseTarget) && (
              <div className={styles.queueActions}>
                {targets.map((to) => {
                  const meta = ADVANCE_META[to];
                  if (!meta) return null;
                  const blocked = to === 'confirmed' && digitalUnpaid;
                  return (
                    <Button
                      key={to}
                      variant={meta.variant}
                      size="sm"
                      disabled={busy || blocked}
                      title={blocked ? 'Payment must be approved before confirming.' : undefined}
                      onClick={() => void advance(o.orderId, to)}
                    >
                      {meta.label}
                    </Button>
                  );
                })}
                {refuseTarget ? (
                  <RefuseControl
                    label={refuseTarget === 'refused' ? 'Mark refused' : 'Cancel'}
                    busy={busy}
                    onConfirm={(reason) => void advance(o.orderId, refuseTarget, reason)}
                  />
                ) : null}
              </div>
            )}

            {err ? <div className={styles.queueError}>{err}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
