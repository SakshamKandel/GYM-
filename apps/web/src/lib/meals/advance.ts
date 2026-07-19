import { mealOrders, type Db } from '@gym/db';
import { orderNumber, type OrderActor, type OrderStatus } from '@gym/shared';
import { after } from 'next/server';
import { notify } from '@/lib/notify';
import { atomicAdvanceOrderSql } from './advanceSql';

/**
 * The single race-safe order status-advance path. Every fulfillment transition
 * — member cancel, partner queue advance, admin override — funnels through here
 * so the CAS guard, event audit, timestamp bookkeeping, and member push stay
 * identical across all three consoles.
 *
 * Concurrency: the UPDATE is a compare-and-swap on `status = expectedStatus`.
 * Two racing advances both target the same expected status; the first flips it
 * and bumps `statusVersion`, while the second returns no row and becomes a 409.
 * Optional `scope` adds the caller's ownership predicate to the same WHERE, so
 * an ownership miss is indistinguishable from a lost race.
 *
 * The status update and append-only event are one PostgreSQL statement. If the
 * event cannot be inserted, PostgreSQL rolls the UPDATE back; a successful CAS
 * can therefore never exist without its audit event.
 *
 * Transition legality and actor authority remain the caller's responsibility
 * (`canActorAdvance` plus payment/cutoff guards from @gym/shared and the route).
 */

export interface AdvanceOrderParams {
  db: Db;
  orderId: string;
  /** The status the row MUST currently be in (CAS guard). */
  expectedStatus: OrderStatus;
  toStatus: OrderStatus;
  /** For the append-only event audit + push copy selection. */
  actor: OrderActor;
  /** accounts.id of the actor (member/staff); null when unknown. */
  actorId: string | null;
  /** Extra ownership predicate folded into the CAS WHERE. */
  scope?: { partnerId?: string; accountId?: string };
  /** Persisted onto cancelReason when cancelling. */
  cancelReason?: string | null;
  now?: Date;
}

/** The updated order row (full columns) or a lost-CAS/scope-miss signal. */
export type AdvanceOrderResult =
  | { ok: true; order: typeof mealOrders.$inferSelect }
  | { ok: false; reason: 'conflict' };

type MealOrder = typeof mealOrders.$inferSelect;
type MealOrderTimestamp =
  | 'cutoffAt'
  | 'placedAt'
  | 'confirmedAt'
  | 'deliveredAt'
  | 'cancelledAt'
  | 'updatedAt';
type AtomicAdvanceOrderRow = Omit<MealOrder, MealOrderTimestamp> & {
  cutoffAt: Date | string;
  placedAt: Date | string;
  confirmedAt: Date | string | null;
  deliveredAt: Date | string | null;
  cancelledAt: Date | string | null;
  updatedAt: Date | string;
};

/** Human window label for the ETA phrase in a status push. */
function windowLabel(window: 'lunch' | 'dinner'): string {
  return window === 'lunch' ? 'lunch' : 'dinner';
}

/**
 * Member-facing push copy for a transition, enriched with the slot ETA (Pack A:
 * "enrich status pushes with ETA + deep-link"). `null` for transitions not worth
 * notifying (e.g. `preparing`). Server-templated — no member free text.
 */
function pushCopyFor(
  order: MealOrder,
  toStatus: OrderStatus,
): { title: string; body: string } | null {
  const code = orderNumber(order.id);
  const slot = windowLabel(order.window);
  switch (toStatus) {
    case 'confirmed':
      return {
        title: 'Order confirmed',
        body: `Order ${code} is confirmed for your ${slot} slot on ${order.deliveryDate}.`,
      };
    case 'out_for_delivery':
      return {
        title: 'Out for delivery',
        body: `Order ${code} is on the way — arriving in your ${slot} window.`,
      };
    case 'delivered':
      return { title: 'Delivered', body: `Order ${code} has been delivered. Enjoy!` };
    case 'cancelled':
      return { title: 'Order cancelled', body: `Order ${code} was cancelled.` };
    case 'refused':
      return { title: 'Delivery refused', body: `Order ${code} was marked refused.` };
    default:
      return null;
  }
}

function requiredDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : requiredDate(value);
}

function mapAtomicOrderRow(row: AtomicAdvanceOrderRow): MealOrder {
  return {
    ...row,
    cutoffAt: requiredDate(row.cutoffAt),
    placedAt: requiredDate(row.placedAt),
    confirmedAt: nullableDate(row.confirmedAt),
    deliveredAt: nullableDate(row.deliveredAt),
    cancelledAt: nullableDate(row.cancelledAt),
    updatedAt: requiredDate(row.updatedAt),
  };
}

export async function advanceOrderStatus(
  params: AdvanceOrderParams,
): Promise<AdvanceOrderResult> {
  const { db, orderId, expectedStatus, toStatus, actor, actorId, scope, cancelReason } = params;
  const now = params.now ?? new Date();

  const mutation = await db.execute<AtomicAdvanceOrderRow>(
    atomicAdvanceOrderSql({
      orderId,
      expectedStatus,
      toStatus,
      actor,
      actorId,
      scope,
      cancelReason,
      now,
      eventId: crypto.randomUUID(),
    }),
  );
  const mutationRow = mutation.rows[0];
  if (!mutationRow) return { ok: false, reason: 'conflict' };
  const order = mapAtomicOrderRow(mutationRow);

  // Member status notification — best-effort after the atomic commit. Routed
  // through `notify` so it also lands in the member's notification center and
  // respects prefs/quiet-hours (Pack B). Fire-and-forget: never awaited, never
  // throws. `data.type:'order'` is the mobile deep-link key (WP-14 switch).
  const copy = pushCopyFor(order, toStatus);
  if (copy) {
    const accountId = order.accountId;
    const orderId = order.id;
    after(() =>
      notify(
        'order_status',
        { accountId },
        { title: copy.title, body: copy.body, data: { type: 'order', id: orderId } },
      ),
    );
  }

  return { ok: true, order };
}
