import { mealOrderEvents, type Db } from '@gym/db';
import type { OrderActor, OrderStatus } from '@gym/shared';

/**
 * Append the append-only audit rows for a BULK order status change (P1-6).
 *
 * Single-order transitions all funnel through `advanceOrderStatus`, where the
 * status update and its `meal_order_events` row are one statement. Lifecycle
 * BULK updates (cancel every future order of a cancelled/refunded plan) can't
 * use that path — their WHERE predicate is the money guard and must stay one
 * set-based statement — so they historically wrote a new status with NO event.
 * The member's timeline and the receipt then contradict the order itself: the
 * order says cancelled, its history stops at "placed".
 *
 * Usage (mirrors the single-order branch of the meal-payment refund route):
 *  1. Read `id` + `status` of the rows the bulk WHERE will match — never change
 *     that predicate.
 *  2. Run the bulk UPDATE with `.returning({ id })`.
 *  3. Call this with the returned ids paired to their pre-update status.
 *
 * Best-effort by design: one multi-row insert (never one round trip per order,
 * and never one push per order — a bulk lifecycle action sends at most one
 * member notification). A failure is logged and swallowed, exactly like the
 * refund route's event append: the money transition already committed and must
 * not be rolled back over an audit write.
 */

export interface BulkOrderTransition {
  orderId: string;
  /** The status the row held BEFORE the bulk update. */
  fromStatus: OrderStatus;
}

export async function appendBulkOrderEvents(
  db: Db,
  transitions: readonly BulkOrderTransition[],
  toStatus: OrderStatus,
  actor: { id: string | null; role: OrderActor },
  note?: string | null,
): Promise<void> {
  if (transitions.length === 0) return;
  try {
    await db.insert(mealOrderEvents).values(
      transitions.map((transition) => ({
        orderId: transition.orderId,
        fromStatus: transition.fromStatus,
        toStatus,
        actorId: actor.id,
        actorRole: actor.role,
        note: note ?? null,
      })),
    );
  } catch (err) {
    console.error('[meals] bulk order event append failed', err);
  }
}
