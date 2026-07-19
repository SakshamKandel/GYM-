import { mealBillingCycles, mealOrders, mealPaymentRequests } from '@gym/db';
import { formatMoney } from '@gym/shared';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — decide one meal manual-payment request (§3 / P4). Reuses
 * `payments.review` (no new key). Money only ever moves along this manual,
 * admin-approved rail (invariant §8d).
 *
 *  POST {action:'approve'|'reject', note?}
 *
 *  reject: CAS status pending→rejected. If the target is an ORDER whose
 *    paymentStatus we flipped to `receipt_submitted` at submit, revert it to
 *    `unpaid` so the member can retry with a fresh receipt.
 *
 *  approve: CAS pending→approved, then idempotently stamp the target `paid`:
 *    - order: paymentStatus (unpaid|receipt_submitted)→paid.
 *    - cycle: status awaiting_payment→paid (this un-gates that week's prepaid
 *      materialization — "never cook unpaid" is satisfied).
 *    `settledAt` is stamped only after the paid flip lands, so a retry after a
 *    partial failure (approved but not yet settled) completes the missing stamp
 *    instead of double-deciding or 404ing. Approval does NOT auto-advance the
 *    order status — the partner/admin still confirms it via the advance route.
 *
 * Guarded by requirePermission('payments.review'); super_admin/main_admin pass.
 */

const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
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
  const { action, note } = parsed.data;

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
      settledAt: mealPaymentRequests.settledAt,
    })
    .from(mealPaymentRequests)
    .where(eq(mealPaymentRequests.id, id))
    .limit(1);
  if (!row) return json({ error: 'not_found' }, 404);

  // ---- reject ----
  if (action === 'reject') {
    if (row.status !== 'pending') return json({ error: 'already_decided' }, 409);
    const rejected = await db
      .update(mealPaymentRequests)
      .set({ status: 'rejected', reviewNote: note ?? null, decidedBy: principal.id, decidedAt: new Date() })
      .where(and(eq(mealPaymentRequests.id, id), eq(mealPaymentRequests.status, 'pending')))
      .returning({ id: mealPaymentRequests.id });
    if (!rejected[0]) return json({ error: 'already_decided' }, 409);

    // Free the order to accept a fresh receipt (best-effort; only reverts the
    // `receipt_submitted` we set at submit, never a paid/refunded order).
    if (row.orderId) {
      try {
        await db
          .update(mealOrders)
          .set({ paymentStatus: 'unpaid', updatedAt: new Date() })
          .where(
            and(eq(mealOrders.id, row.orderId), eq(mealOrders.paymentStatus, 'receipt_submitted')),
          );
      } catch (err) {
        console.error('[meals] order paymentStatus revert failed', err);
      }
    }

    await logAudit(principal, 'meal_payment.reject', 'meal_payment_request', row.id, {
      accountId: row.accountId,
      orderId: row.orderId,
      cycleId: row.cycleId,
      amountMinor: row.amountMinor,
      note,
    }, ip);
    // Reason surfaced to the member (was a bare "not approved" with no why —
    // WP-8 "reject/refund reason surfaced"). `note` is staff-authored (an admin
    // reviewing a receipt), not member free text, so no maskPii/attribution
    // step is needed for this direction (§7.2-S2 only gates the reverse).
    after(() =>
      notify(
        'payment_reviewed_member',
        { accountId: row.accountId },
        {
          title: 'Meal payment update',
          body: note
            ? `Your meal payment was not approved this time: ${note}`
            : 'Your meal payment was not approved this time. Please resubmit a clear receipt.',
          data: { type: 'meal_payment_decided', id: row.orderId ?? row.cycleId ?? undefined },
        },
      ),
    );
    return json({ ok: true }, 200);
  }

  // ---- approve ----
  if (row.status === 'rejected' || row.status === 'refunded') {
    return json({ error: 'already_decided' }, 409);
  }

  // Guard the target's LIVE state before a fresh approval. Idempotent retries
  // (row already 'approved', settledAt still null) skip this — they only finish
  // the settle. Two invariants enforced here:
  //   1. Never capture a payment for an order the member already cancelled/
  //      refused — that order will never deliver, so approving its receipt would
  //      book real money with no fulfilment and no refund signal.
  //   2. Never approve a second live request against a target another request
  //      already funded (the one-live-request rule is a non-atomic read at
  //      submit time; this catches the sibling that slipped past it).
  if (row.status === 'pending') {
    if (row.orderId) {
      const [order] = await db
        .select({ status: mealOrders.status, paymentStatus: mealOrders.paymentStatus })
        .from(mealOrders)
        .where(eq(mealOrders.id, row.orderId))
        .limit(1);
      if (order) {
        if (order.status === 'cancelled' || order.status === 'refused') {
          return json({ error: 'order_not_active' }, 409);
        }
        if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') {
          return json({ error: 'order_already_settled' }, 409);
        }
      }
    } else if (row.cycleId) {
      const [cycle] = await db
        .select({ status: mealBillingCycles.status })
        .from(mealBillingCycles)
        .where(eq(mealBillingCycles.id, row.cycleId))
        .limit(1);
      if (cycle && cycle.status !== 'awaiting_payment') {
        return json({ error: 'cycle_not_payable' }, 409);
      }
    }
  }

  // Flip pending → approved (CAS). An already-'approved' row skips the flip and
  // completes any missing side effect (idempotent re-run).
  let flipped = false;
  if (row.status === 'pending') {
    const upd = await db
      .update(mealPaymentRequests)
      .set({ status: 'approved', reviewNote: note ?? null, decidedBy: principal.id, decidedAt: new Date() })
      .where(and(eq(mealPaymentRequests.id, id), eq(mealPaymentRequests.status, 'pending')))
      .returning({ id: mealPaymentRequests.id });
    if (upd[0]) {
      flipped = true;
    } else {
      // Lost the race — re-read: another admin approved (continue) or rejected (bail).
      const [after2] = await db
        .select({ status: mealPaymentRequests.status, settledAt: mealPaymentRequests.settledAt })
        .from(mealPaymentRequests)
        .where(eq(mealPaymentRequests.id, id))
        .limit(1);
      if (!after2 || after2.status !== 'approved') return json({ error: 'already_decided' }, 409);
      row.settledAt = after2.settledAt;
    }
  }

  // Idempotent side effect: stamp the target `paid`, then stamp settledAt. A
  // retry re-runs only while settledAt is still null.
  if (!row.settledAt) {
    let targetPaid = false;
    if (row.orderId) {
      await db
        .update(mealOrders)
        .set({ paymentStatus: 'paid', updatedAt: new Date() })
        .where(
          and(
            eq(mealOrders.id, row.orderId),
            inArray(mealOrders.paymentStatus, ['unpaid', 'receipt_submitted']),
            // Atomic backstop for the pre-check above: never stamp a terminal
            // order paid, even if it was cancelled after the guard read.
            notInArray(mealOrders.status, ['cancelled', 'refused']),
          ),
        );
      const [target] = await db
        .select({ paymentStatus: mealOrders.paymentStatus, status: mealOrders.status })
        .from(mealOrders)
        .where(eq(mealOrders.id, row.orderId))
        .limit(1);
      targetPaid =
        target?.paymentStatus === 'paid' &&
        target.status !== 'cancelled' &&
        target.status !== 'refused';
    } else if (row.cycleId) {
      await db
        .update(mealBillingCycles)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(
          and(
            eq(mealBillingCycles.id, row.cycleId),
            eq(mealBillingCycles.status, 'awaiting_payment'),
          ),
        );
      const [target] = await db
        .select({ status: mealBillingCycles.status })
        .from(mealBillingCycles)
        .where(eq(mealBillingCycles.id, row.cycleId))
        .limit(1);
      targetPaid = target?.status === 'paid';
    }

    // Never declare the receipt settled if a concurrent cancellation/void won
    // after the pre-check. The approved request remains available to the
    // dedicated refund workflow, which performs reversal + cancellation.
    if (!targetPaid) return json({ error: 'refund_required' }, 409);

    await db
      .update(mealPaymentRequests)
      .set({ settledAt: new Date() })
      .where(eq(mealPaymentRequests.id, id));
  }

  // Audit + push only on a FRESH decision.
  if (flipped) {
    await logAudit(principal, 'meal_payment.approve', 'meal_payment_request', row.id, {
      accountId: row.accountId,
      orderId: row.orderId,
      cycleId: row.cycleId,
      amountMinor: row.amountMinor,
      note,
    }, ip);
    after(() =>
      notify(
        'payment_reviewed_member',
        { accountId: row.accountId },
        {
          title: 'Meal payment approved',
          body: `Your meal payment of ${formatMoney(row.amountMinor, row.currency)} was approved.`,
          data: { type: 'meal_payment_decided', id: row.orderId ?? row.cycleId ?? undefined },
        },
      ),
    );
  }

  return json({ ok: true }, 200);
}
