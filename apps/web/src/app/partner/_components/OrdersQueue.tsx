'use client';

import { canActorAdvance, ORDER_STATUSES, type OrderStatus } from '@gym/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Badge, Button, ConfirmButton, EmptyState } from '@/components/console';
import type { PartnerOrderView } from '../_data';
import {
  formatDateLabel,
  formatMoney,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_LABEL,
  windowLabel,
} from '../_format';

/**
 * The partner fulfillment queue (Today's Orders + Subscriptions fulfillment).
 * Each card is one order in the STRICT partner projection — delivery-necessary
 * fields only, never member identity. Advance buttons are derived from
 * `canActorAdvance(from, to, 'partner')` so the UI can never offer an illegal or
 * unauthorized transition; the server re-validates every one via CAS.
 */

/** Per-transition button copy + emphasis (partner-reachable transitions only). */
const ADVANCE_META: Partial<Record<OrderStatus, { label: string; variant: 'primary' | 'ghost' }>> = {
  confirmed: { label: 'Confirm order', variant: 'primary' },
  preparing: { label: 'Start preparing', variant: 'primary' },
  out_for_delivery: { label: 'Out for delivery', variant: 'primary' },
  delivered: { label: 'Mark delivered', variant: 'primary' },
  refused: { label: 'Mark refused', variant: 'ghost' },
};

function advanceTargets(from: OrderStatus): OrderStatus[] {
  return ORDER_STATUSES.filter(
    (to) => to !== 'cancelled' && canActorAdvance(from, to, 'partner') && ADVANCE_META[to],
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

  async function advance(orderId: string, toStatus: OrderStatus) {
    setBusyId(orderId);
    setErrorById((e) => ({ ...e, [orderId]: '' }));
    try {
      const res = await fetch(`/api/partner/orders/${encodeURIComponent(orderId)}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ toStatus }),
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {visible.map((o) => {
        const targets = advanceTargets(o.status);
        const canCancel = canActorAdvance(o.status, 'cancelled', 'partner');
        const digitalUnpaid =
          o.paymentMethod !== 'cod' && o.paymentStatus !== 'paid' && o.paymentStatus !== 'refunded';
        const busy = busyId === o.orderId;
        const err = errorById[o.orderId];

        return (
          <div key={o.orderId} className="gt-card" style={{ padding: 18 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 16 }}>{formatDateLabel(o.deliveryDate)}</strong>
                <span style={{ color: 'var(--gt-text-dim)', fontSize: 13 }}>
                  {windowLabel(o.window)}
                </span>
              </div>
              <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
            </div>

            <div
              style={{
                marginTop: 12,
                display: 'grid',
                gridTemplateColumns: 'minmax(200px, 1fr) minmax(200px, 1fr)',
                gap: 14,
              }}
            >
              <div>
                <FieldLabel>Deliver to</FieldLabel>
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
                <FieldLabel>Items</FieldLabel>
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                  {o.items.map((it, i) => (
                    <li
                      key={`${o.orderId}-${i}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 14,
                        gap: 8,
                      }}
                    >
                      <span>
                        {it.qty}× {it.name}
                      </span>
                      <span style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap' }}>
                        {formatMoney(it.priceMinorSnapshot * it.qty, o.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: '1px solid var(--gt-border)',
                    fontSize: 15,
                  }}
                >
                  <strong>Total</strong>
                  <strong>{formatMoney(o.totalMinor, o.currency)}</strong>
                </div>
                <div style={{ fontSize: 12, color: 'var(--gt-text-faint)', marginTop: 4 }}>
                  {PAYMENT_LABEL[o.paymentMethod] ?? o.paymentMethod}
                  {digitalUnpaid ? ' · awaiting payment' : o.paymentStatus === 'paid' ? ' · paid' : ''}
                </div>
              </div>
            </div>

            {(targets.length > 0 || canCancel) && (
              <div
                style={{
                  marginTop: 14,
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
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
                {canCancel ? (
                  <ConfirmButton
                    label="Cancel"
                    confirmLabel="Confirm cancel"
                    busyLabel="Cancelling…"
                    size="sm"
                    busy={busy}
                    onConfirm={() => void advance(o.orderId, 'cancelled')}
                  />
                ) : null}
              </div>
            )}

            {err ? (
              <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 8 }}>{err}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--gt-text-faint)',
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}
