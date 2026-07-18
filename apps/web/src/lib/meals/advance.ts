import { mealOrderEvents, mealOrders, type Db } from '@gym/db';
import type { OrderActor, OrderStatus } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { sendPushToAccount } from '@/lib/push';

/**
 * The single race-safe order status-advance path (§3 / invariant §8b). Every
 * fulfillment transition — member cancel, partner queue advance, admin override
 * — funnels through here so the CAS guard, event audit, timestamp bookkeeping
 * and member push stay identical across all three consoles.
 *
 * Concurrency: the UPDATE is a compare-and-swap on `status = expectedStatus`
 * (neon-http has no transactions). Two racing advances of the same order both
 * target the same expected status; the first flips it and bumps
 * `statusVersion`, the second matches 0 rows → `{ ok:false, reason:'conflict' }`
 * (the route maps that to 409). Optional `scope` adds the caller's ownership
 * predicate to the same WHERE (partnerId for a partner, accountId for a member)
 * so a mismatched scope also yields 0 rows — an IDOR attempt is indistinguishable
 * from a lost race, never a 200.
 *
 * The transition's LEGALITY and the actor's AUTHORITY are the caller's job
 * (canActorAdvance + payment/cutoff guards from @gym/shared and the route). This
 * helper assumes the caller already validated them and only enforces the atomic
 * write.
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

/** Member-facing push copy for the transitions worth notifying (§3). */
const PUSH_COPY: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  confirmed: { title: 'Order confirmed', body: 'Your meal order has been confirmed.' },
  out_for_delivery: { title: 'Out for delivery', body: 'Your meal is on the way.' },
  delivered: { title: 'Delivered', body: 'Your meal has been delivered. Enjoy!' },
  cancelled: { title: 'Order cancelled', body: 'Your meal order was cancelled.' },
  refused: { title: 'Delivery refused', body: 'Your meal order was marked refused.' },
};

export async function advanceOrderStatus(
  params: AdvanceOrderParams,
): Promise<AdvanceOrderResult> {
  const { db, orderId, expectedStatus, toStatus, actor, actorId, scope, cancelReason } = params;
  const now = params.now ?? new Date();

  const predicates = [eq(mealOrders.id, orderId), eq(mealOrders.status, expectedStatus)];
  if (scope?.partnerId) predicates.push(eq(mealOrders.partnerId, scope.partnerId));
  if (scope?.accountId) predicates.push(eq(mealOrders.accountId, scope.accountId));

  // Only the timestamp for THIS transition is stamped; the others keep their
  // frozen value (a re-advance can never happen — the CAS forbids leaving a
  // terminal state). The set literal is passed inline so drizzle accepts the
  // SQL statusVersion increment (an explicit $inferInsert annotation would type
  // that column as number and reject the SQL).
  const updated = await db
    .update(mealOrders)
    .set({
      status: toStatus,
      statusVersion: sql`${mealOrders.statusVersion} + 1`,
      updatedAt: now,
      decidedBy: actorId,
      ...(toStatus === 'confirmed' ? { confirmedAt: now } : {}),
      ...(toStatus === 'delivered' ? { deliveredAt: now } : {}),
      ...(toStatus === 'cancelled' ? { cancelledAt: now, cancelReason: cancelReason ?? null } : {}),
    })
    .where(and(...predicates))
    .returning();
  const order = updated[0];
  if (!order) return { ok: false, reason: 'conflict' };

  // Append-only audit + push are best-effort AFTER the committed CAS — a failure
  // here must never undo the (already durable) status change (mirrors logAudit).
  try {
    await db.insert(mealOrderEvents).values({
      orderId: order.id,
      fromStatus: expectedStatus,
      toStatus,
      actorId,
      actorRole: actor,
    });
  } catch (err) {
    console.error('[meals] order event append failed', err);
  }

  const copy = PUSH_COPY[toStatus];
  if (copy) {
    const accountId = order.accountId;
    after(() =>
      sendPushToAccount(accountId, {
        title: copy.title,
        body: copy.body,
        data: { type: 'meal_order', orderId: order.id, status: toStatus },
      }),
    );
  }

  return { ok: true, order };
}
