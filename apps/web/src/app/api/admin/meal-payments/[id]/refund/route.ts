import { mealBillingCycles, mealOrderEvents, mealOrders, mealPaymentRequests } from '@gym/db';
import { ktmDateString, TERMINAL_ORDER_STATUSES } from '@gym/shared';
import { and, eq, gt, inArray, notInArray, or, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — refund an already-APPROVED meal payment (§3 / P4). Forks the
 * subscription-payment refund pattern: idempotent reversal, CAS status-flip LAST.
 * Money only ever un-moves along this manual, admin-approved rail; the engine
 * never auto-refunds.
 *
 *  POST {reason?} → CAS approved→refunded with the target's paid mark reversed:
 *    - order:  paymentStatus paid→refunded.
 *    - cycle:  status paid→void (this re-gates the week — no more materialization).
 *
 *  Refundability (§3, "before production only"): an order is NON-refundable once
 *  it is in production — status in {preparing, out_for_delivery, delivered,
 *  refused}, or (for a still-open order) past its frozen `cutoffAt` (food
 *  committed). A cancelled order stays refundable. A cycle is refundable only
 *  before its billed week begins (KTM). The reversals are idempotent CAS writes
 *  and the request flip is LAST, so a retry after a partial crash safely
 *  finishes; the loser of a refund race gets 409 already_refunded.
 *
 * Guarded by requirePermission('payments.review'); super_admin/main_admin pass.
 */

const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'payments.review');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { reason } = parsed.data;

  const db = getDb();
  const ip = clientIp(req);

  const [row] = await db
    .select({
      id: mealPaymentRequests.id,
      accountId: mealPaymentRequests.accountId,
      orderId: mealPaymentRequests.orderId,
      cycleId: mealPaymentRequests.cycleId,
      amountMinor: mealPaymentRequests.amountMinor,
      status: mealPaymentRequests.status,
    })
    .from(mealPaymentRequests)
    .where(eq(mealPaymentRequests.id, id))
    .limit(1);
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.status === 'refunded') return json({ error: 'already_refunded' }, 409);
  if (row.status !== 'approved') return json({ error: 'not_approved' }, 409);

  const now = new Date();

  // Production guard (§3): refuse once the food is committed.
  if (row.orderId) {
    const [order] = await db
      .select({
        status: mealOrders.status,
        paymentStatus: mealOrders.paymentStatus,
        cutoffAt: mealOrders.cutoffAt,
      })
      .from(mealOrders)
      .where(eq(mealOrders.id, row.orderId))
      .limit(1);
    if (!order) return json({ error: 'target_not_found' }, 409);
    const inProduction =
      order.status === 'preparing' ||
      order.status === 'out_for_delivery' ||
      order.status === 'delivered' ||
      order.status === 'refused';
    const postCutoff = order.status !== 'cancelled' && now >= order.cutoffAt;
    if (inProduction || postCutoff) return json({ error: 'non_refundable' }, 409);
    if (
      order.paymentStatus !== 'paid' &&
      order.paymentStatus !== 'receipt_submitted' &&
      order.paymentStatus !== 'refunded'
    ) {
      return json({ error: 'payment_state_conflict' }, 409);
    }
  } else if (row.cycleId) {
    const [cycle] = await db
      .select({ weekStart: mealBillingCycles.weekStart, status: mealBillingCycles.status })
      .from(mealBillingCycles)
      .where(eq(mealBillingCycles.id, row.cycleId))
      .limit(1);
    if (!cycle) return json({ error: 'target_not_found' }, 409);
    // Refundable only before the billed week begins (KTM date compare).
    if (ktmDateString(now) >= cycle.weekStart) {
      return json({ error: 'non_refundable' }, 409);
    }
    if (
      cycle.status !== 'paid' &&
      cycle.status !== 'awaiting_payment' &&
      cycle.status !== 'void'
    ) {
      return json({ error: 'payment_state_conflict' }, 409);
    }
  }

  // 1. Reverse the target's paid mark (idempotent CAS — a retry matches 0 rows).
  if (row.orderId) {
    const [before] = await db
      .select({ status: mealOrders.status })
      .from(mealOrders)
      .where(eq(mealOrders.id, row.orderId))
      .limit(1);
    if (!before) return json({ error: 'target_not_found' }, 409);
    const reversed = await db
      .update(mealOrders)
      .set({
        paymentStatus: 'refunded',
        status: 'cancelled',
        statusVersion: sql`${mealOrders.statusVersion} + 1`,
        cancelledAt: now,
        cancelReason: 'Refunded by support',
        decidedBy: principal.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(mealOrders.id, row.orderId),
          eq(mealOrders.status, before.status),
          inArray(mealOrders.paymentStatus, ['paid', 'receipt_submitted']),
          inArray(mealOrders.status, ['pending', 'confirmed', 'cancelled']),
          or(eq(mealOrders.status, 'cancelled'), gt(mealOrders.cutoffAt, now)),
        ),
      )
      .returning({ id: mealOrders.id });

    if (!reversed[0]) {
      const [current] = await db
        .select({ status: mealOrders.status, paymentStatus: mealOrders.paymentStatus })
        .from(mealOrders)
        .where(eq(mealOrders.id, row.orderId))
        .limit(1);
      if (!current || current.status !== 'cancelled' || current.paymentStatus !== 'refunded') {
        return json({ error: 'non_refundable' }, 409);
      }
    } else if (before.status !== 'cancelled') {
      try {
        await db.insert(mealOrderEvents).values({
          orderId: row.orderId,
          fromStatus: before.status,
          toStatus: 'cancelled',
          actorId: principal.id,
          actorRole: 'admin',
        });
      } catch (err) {
        console.error('[meals] refund cancellation event append failed', err);
      }
    }
  } else if (row.cycleId) {
    await db
      .update(mealBillingCycles)
      .set({ status: 'void', updatedAt: now })
      .where(
        and(
          eq(mealBillingCycles.id, row.cycleId),
          inArray(mealBillingCycles.status, ['paid', 'awaiting_payment']),
        ),
      );
    // The billed week may already have materialized orders (horizon = today+
    // tomorrow) spawned with paymentStatus='paid'. Voiding the cycle alone would
    // leave the partner cooking meals the member has just been refunded for —
    // cancel EVERY still-live (non-terminal) order of this cycle so a refunded
    // week delivers nothing, and reverse their paid mark. Refundability already
    // requires the week to be entirely in the future, so none are delivered.
    await db
      .update(mealOrders)
      .set({
        status: 'cancelled',
        statusVersion: sql`${mealOrders.statusVersion} + 1`,
        cancelledAt: now,
        cancelReason: 'Cycle refunded',
        paymentStatus: 'refunded',
        decidedBy: principal.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(mealOrders.cycleId, row.cycleId),
          notInArray(mealOrders.status, [...TERMINAL_ORDER_STATUSES]),
        ),
      );
  }

  // 2. Status flip LAST (CAS approved→refunded). Loser of a race / retry → 409.
  const flipped = await db
    .update(mealPaymentRequests)
    .set({
      status: 'refunded',
      reviewNote: reason ?? null,
      decidedBy: principal.id,
      decidedAt: now,
      refundedAt: now,
    })
    .where(and(eq(mealPaymentRequests.id, id), eq(mealPaymentRequests.status, 'approved')))
    .returning({ id: mealPaymentRequests.id });
  if (!flipped[0]) return json({ error: 'already_refunded' }, 409);

  await logAudit(principal, 'meal_payment.refund', 'meal_payment_request', row.id, {
    accountId: row.accountId,
    orderId: row.orderId,
    cycleId: row.cycleId,
    amountMinor: row.amountMinor,
    reason,
  }, ip);

  after(() =>
    sendPushToAccount(row.accountId, {
      title: 'Meal payment refunded',
      body: 'Your meal payment was refunded.',
      data: { type: 'meal_payment_decided' },
    }),
  );

  return json({ ok: true }, 200);
}
