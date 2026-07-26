import {
  mealBillingCycles,
  mealDisputes,
  mealOrderEvents,
  mealOrders,
  mealPaymentRequests,
} from '@gym/db';
import { formatMoney, ktmDateString, TERMINAL_ORDER_STATUSES } from '@gym/shared';
import { and, eq, gt, inArray, notInArray, or, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
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
 *  The ONE way past the production guard is a RESOLVED dispute on that order.
 *  Disputes are openable only on a delivered or already-paid order, which is the
 *  exact set the guard refuses, so before this every resolved dispute was a dead
 *  end for both the member and the operator. A dispute-backed refund reverses the
 *  PAYMENT ONLY — the order keeps its delivered/production status, since the food
 *  really did go out — and the partner's earned balance drops by that order on
 *  its own, because every partner money read counts `paid` and excludes
 *  `refunded`. Every other protection is unchanged: same permission, same
 *  audit, same LAST status flip, same 409 on a second refund.
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
      currency: mealPaymentRequests.currency,
      status: mealPaymentRequests.status,
    })
    .from(mealPaymentRequests)
    .where(eq(mealPaymentRequests.id, id))
    .limit(1);
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.status === 'refunded') return json({ error: 'already_refunded' }, 409);
  if (row.status !== 'approved') return json({ error: 'not_approved' }, 409);

  const now = new Date();

  // A dispute the team RESOLVED is the operator's recorded decision that this
  // member should get their money back, so it is the one thing allowed past the
  // production guard below. Without it the dispute rail dead-ends: a dispute can
  // only be opened on a delivered or already-paid order, and those are precisely
  // the orders the guard refuses, so every resolved dispute was unrefundable.
  // Only `resolved` counts — open/reviewing are undecided, and rejected is a
  // decision that the money stays put.
  let resolvedDisputeId: string | null = null;
  if (row.orderId) {
    const [dispute] = await db
      .select({ id: mealDisputes.id })
      .from(mealDisputes)
      .where(and(eq(mealDisputes.orderId, row.orderId), eq(mealDisputes.status, 'resolved')))
      .limit(1);
    resolvedDisputeId = dispute?.id ?? null;
  }

  // Set when the order is already in production, so there is nothing left to
  // cancel: that branch reverses the PAYMENT ONLY and leaves the fulfilment
  // record standing, because a delivered order really was delivered.
  let paymentOnly = false;

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
    if (inProduction || postCutoff) {
      if (!resolvedDisputeId) return json({ error: 'non_refundable' }, 409);
      // Two shapes of upheld claim, two outcomes. Food already committed
      // (preparing → refused): nothing is left to cancel, so reverse the money
      // and leave fulfilment standing. Still pending/confirmed but past cutoff
      // ("I paid and it never came"): cancel it exactly as any other refund
      // does, so the kitchen also stops, and only the cutoff predicate is
      // stood down below.
      paymentOnly = inProduction;
    }
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
  if (row.orderId && paymentOnly) {
    // Dispute-backed reversal of a committed order. Money only: `status`,
    // `cancelledAt`, `cancelReason`, `decidedBy` and `statusVersion` are all left
    // exactly as fulfilment left them, so the delivery history stays true and no
    // status event is invented for a status that never changed.
    //
    // Same double-refund protection as the branch below: the CAS only matches
    // captured money, so a retry (or the loser of a race) matches 0 rows and
    // falls through to the already-refunded re-read.
    const reversed = await db
      .update(mealOrders)
      .set({ paymentStatus: 'refunded', updatedAt: now })
      .where(
        and(
          eq(mealOrders.id, row.orderId),
          inArray(mealOrders.paymentStatus, ['paid', 'receipt_submitted']),
        ),
      )
      .returning({ id: mealOrders.id });

    if (!reversed[0]) {
      const [current] = await db
        .select({ paymentStatus: mealOrders.paymentStatus })
        .from(mealOrders)
        .where(eq(mealOrders.id, row.orderId))
        .limit(1);
      if (current?.paymentStatus !== 'refunded') {
        return json({ error: 'non_refundable' }, 409);
      }
    }
  } else if (row.orderId) {
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
          // Past-cutoff orders are normally refused here. A RESOLVED dispute
          // stands this one predicate down (and only this one): an upheld claim
          // on a paid order that never arrived has to be able to stop the
          // kitchen AND return the money, and every such order is past cutoff by
          // the time the member can tell it never came. Both CAS guards above
          // still hold, so this can never strand or double-reverse money.
          resolvedDisputeId
            ? undefined
            : or(eq(mealOrders.status, 'cancelled'), gt(mealOrders.cutoffAt, now)),
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
    // Which dispute authorized a refund past the production guard, and whether
    // fulfilment was left standing. Null/false on an ordinary pre-production
    // refund, so the existing meta reads exactly as before.
    disputeId: resolvedDisputeId,
    paymentOnly,
  }, ip);

  // WP-8: surface the amount (and reason, when given) in the refund push —
  // was a bare "was refunded" with no figure or why.
  after(() =>
    notify(
      'payment_reviewed_member',
      { accountId: row.accountId },
      {
        title: 'Meal payment refunded',
        body: reason
          ? `Your ${formatMoney(row.amountMinor, row.currency)} meal payment was refunded: ${reason}`
          : `Your ${formatMoney(row.amountMinor, row.currency)} meal payment was refunded.`,
        data: { type: 'meal_payment_decided', id: row.orderId ?? row.cycleId ?? undefined },
      },
    ),
  );

  return json({ ok: true }, 200);
}
