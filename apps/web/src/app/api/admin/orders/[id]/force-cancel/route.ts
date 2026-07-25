import { mealOrders } from '@gym/db';
import {
  canActorAdvance,
  maskPii,
  orderNumber,
  orderPaymentMutationBlock,
} from '@gym/shared';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { advanceOrderStatus } from '@/lib/meals';
import { notify } from '@/lib/notify';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin FORCED cancel of a PAID order — the terminal escape hatch for money
 * that would otherwise be stuck (P0-1).
 *
 * Before this route, a prepaid order that went wrong had no way out: the
 * partner refuse path, the admin override path and the manual-payment refund
 * rail all (correctly) refuse to strand captured money, so a `paid` order sat
 * non-terminal forever while the platform held the member's cash.
 *
 * What it does, in ONE compare-and-set through the shared fulfillment engine
 * (`advanceOrderStatus` → `atomicAdvanceOrderSql`): CAS `status = <current>` +
 * `payment_status = 'paid'` → status `cancelled`, payment_status `refunded`,
 * with the append-only `meal_order_events` row written by the same statement
 * (so a forced cancel can never exist without its audit event). No divergent
 * admin write path, no partial state.
 *
 * Guards — no existing guard is weakened, and the entry bar is raised:
 *  1. `payments.review` AND `orders.review`. This is strictly stricter than the
 *     plain override route (which needs only `orders.review`): reversing money
 *     requires the money permission too.
 *  2. Structural legality still comes from `canActorAdvance(from,'cancelled',
 *     'admin')`, so a terminal order is never re-cancelled.
 *  3. Only `paid` qualifies. `unpaid`/`refunded` belong on the ordinary
 *     override route (409 `not_paid`); a receipt still under review must be
 *     decided on the payments queue first (409 `payment_review_required`, the
 *     shared PaymentMutationBlock vocabulary).
 *
 * The actual money movement stays manual, exactly like the refund rail: this
 * marks the order refunded and stops the kitchen. If the payment arrived
 * through a `meal_payment_requests` row, that row is deliberately untouched —
 * the admin can still run the normal refund rail afterwards to close the
 * ledger (it re-reads the order, finds it cancelled+refunded, and completes).
 */

const bodySchema = z.object({
  // Required: a forced money reversal is always explained — the reason is
  // audited AND relayed to the member.
  reason: z.string().trim().min(1).max(500),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Money gate first, then the order-oversight gate. Both must pass.
  const payments = await requirePermission(req, 'payments.review');
  if (payments instanceof Response) return payments;
  const principal = await requirePermission(req, 'orders.review');
  if (principal instanceof Response) return principal;

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { reason } = parsed.data;

  const db = getDb();
  const [order] = await db
    .select({
      status: mealOrders.status,
      paymentStatus: mealOrders.paymentStatus,
      paymentMethod: mealOrders.paymentMethod,
      totalMinor: mealOrders.totalMinor,
      currency: mealOrders.currency,
      source: mealOrders.source,
      cycleId: mealOrders.cycleId,
    })
    .from(mealOrders)
    .where(eq(mealOrders.id, id))
    .limit(1);
  if (!order) return json({ error: 'not_found' }, 404);

  const from = order.status;
  if (!canActorAdvance(from, 'cancelled', 'admin')) {
    return json({ error: 'illegal_transition' }, 409);
  }

  // Captured money only. Anything else keeps its existing, unchanged route.
  if (order.paymentStatus !== 'paid') {
    const block = orderPaymentMutationBlock(order.paymentStatus);
    return json({ error: block ?? 'not_paid' }, 409);
  }

  const result = await advanceOrderStatus({
    db,
    orderId: id,
    expectedStatus: from,
    toStatus: 'cancelled',
    actor: 'admin',
    actorId: principal.id,
    cancelReason: reason,
    reversePayment: true,
  });
  if (!result.ok) return json({ error: 'conflict' }, 409);

  await logAudit(
    principal,
    'order.force_cancel',
    'meal_orders',
    id,
    {
      from,
      to: 'cancelled',
      paymentStatus: { from: 'paid', to: 'refunded' },
      // Who has to hand the money back: the platform (digital) or the
      // restaurant (cash collected at the door).
      paymentMethod: order.paymentMethod,
      amountMinor: order.totalMinor,
      currency: order.currency,
      // A subscription order's week may still be funded by its billing cycle —
      // recorded so the reviewer can trace the rest of the money.
      source: order.source,
      cycleId: order.cycleId,
      reason,
    },
    clientIp(req),
  );

  // Tell the member WHY, on top of the generic cancellation push the shared
  // engine already sent. Server-templated; the admin's free text is maskPii'd
  // and attributed, never presented as platform copy. Fire-and-forget.
  const code = orderNumber(id);
  after(() =>
    notify(
      'order_status',
      { accountId: result.order.accountId },
      {
        title: 'Order cancelled, refund on the way',
        body: `Order ${code}: ${maskPii(reason)}`,
        data: { type: 'order', id },
      },
    ),
  );

  return json({ ok: true }, 200);
}
