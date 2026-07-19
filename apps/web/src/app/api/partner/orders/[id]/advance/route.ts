import { mealOrderItems, mealOrders } from '@gym/db';
import {
  ORDER_STATUSES,
  canActorAdvance,
  maskPii,
  orderNumber,
  orderPaymentMutationBlock,
  partnerCanRefuse,
  partnerRefuseTarget,
  type OrderStatus,
} from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { advanceOrderStatus } from '@/lib/meals';
import { notify } from '@/lib/notify';
import { serializePartnerOrder } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner order status advance (§3). The ONE fulfillment transition a partner can
 * drive. Layered guards:
 *  1. requirePartner → the caller's OWN partnerId (scope). A foreign order id is
 *     never found under this scope → 404 (indistinguishable from "doesn't exist",
 *     no IDOR oracle).
 *  2. Legality check — for a plain forward advance, `canActorAdvance(from, to,
 *     'partner')`. For a REFUSE/reject (`toStatus` 'cancelled'/'refused'), the
 *     WIDER `partnerCanRefuse(from)` (B6): any pre-delivery stage, not just
 *     `out_for_delivery`, and the client-picked `toStatus` must match the one
 *     legal target (`partnerRefuseTarget`) so a partner can't misdirect the CAS.
 *  3. Payment gate: pending→confirmed only when the order is already paid (digital
 *     receipt approved) OR is COD (reconciled on delivery).
 *  4. The atomic CAS write (advanceOrderStatus) with `scope.partnerId` folded into
 *     the WHERE — a lost race or scope-miss both yield 409, never a 200.
 *  5. On a reason-carrying refuse, the order's `cancelReason` is persisted and
 *     the member is told WHY via `notify` (B7) — server-templated, with the
 *     partner's free text `maskPii`'d and attributed, never presented as
 *     platform-authored (§7.2-S2).
 */

const bodySchema = z.object({
  toStatus: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]),
  /** Optional reason for a refuse/reject — relayed to the member (B6/B7). */
  reason: z.string().trim().min(1).max(200).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { principal, partnerId } = guard;

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { toStatus, reason } = parsed.data;

  const db = getDb();

  // Load the order UNDER the partner's scope — a foreign / missing id is a 404.
  const [order] = await db
    .select({
      status: mealOrders.status,
      paymentMethod: mealOrders.paymentMethod,
      paymentStatus: mealOrders.paymentStatus,
    })
    .from(mealOrders)
    .where(and(eq(mealOrders.id, id), eq(mealOrders.partnerId, partnerId)))
    .limit(1);
  if (!order) return json({ error: 'not_found' }, 404);

  const from = order.status;
  const isRefuse = toStatus === 'cancelled' || toStatus === 'refused';

  if (isRefuse) {
    // B6: a partner may refuse/reject from ANY pre-delivery stage, wider than
    // the normal actor matrix (which only permits out_for_delivery→refused and
    // pending/confirmed→cancelled, never preparing→cancelled by a partner). The
    // legal TARGET is derived server-side — the client's `toStatus` must match
    // it exactly, so a partner can never misdirect the CAS onto the wrong
    // terminal status.
    const target = partnerRefuseTarget(from);
    if (!target || target !== toStatus || !partnerCanRefuse(from)) {
      return json({ error: 'illegal_transition' }, 409);
    }
  } else if (!canActorAdvance(from, toStatus, 'partner')) {
    return json({ error: 'illegal_transition' }, 409);
  }

  if (isRefuse) {
    const paymentBlock = orderPaymentMutationBlock(order.paymentStatus);
    if (paymentBlock) return json({ error: paymentBlock }, 409);
  }

  // Payment gate: never confirm a digital order until its receipt is approved.
  if (toStatus === 'confirmed') {
    const paid = order.paymentStatus === 'paid' || order.paymentMethod === 'cod';
    if (!paid) return json({ error: 'payment_required' }, 409);
  }

  const result = await advanceOrderStatus({
    db,
    orderId: id,
    expectedStatus: from,
    toStatus,
    actor: 'partner',
    actorId: principal.id,
    scope: { partnerId },
    // Threaded onto mealOrders.cancelReason for a 'cancelled' target; a
    // 'refused' (at-the-door) target has no engine-side column for it, so it is
    // persisted separately just below.
    cancelReason: isRefuse ? (reason ?? null) : undefined,
  });
  if (!result.ok) {
    if (isRefuse) {
      const [current] = await db
        .select({ paymentStatus: mealOrders.paymentStatus })
        .from(mealOrders)
        .where(and(eq(mealOrders.id, id), eq(mealOrders.partnerId, partnerId)))
        .limit(1);
      const currentBlock = current
        ? orderPaymentMutationBlock(current.paymentStatus)
        : null;
      if (currentBlock) return json({ error: currentBlock }, 409);
    }
    return json({ error: 'conflict' }, 409);
  }

  // 'refused' has no dedicated persistence column in the shared advance engine
  // (only 'cancelled' sets cancel_reason) — set it here so the reason survives
  // on the order row for the timeline/receipt either way (B7).
  if (toStatus === 'refused' && reason) {
    await db
      .update(mealOrders)
      .set({ cancelReason: reason })
      .where(and(eq(mealOrders.id, id), eq(mealOrders.partnerId, partnerId)));
    result.order.cancelReason = reason;
  }

  // Tell the member WHY (B7) — an addendum to the generic status push the
  // shared engine already sent. Server-templated; the partner's free text is
  // maskPii'd + attributed, never presented as platform-authored (§7.2-S2).
  if (isRefuse && reason) {
    const code = orderNumber(id);
    const title = toStatus === 'refused' ? 'Why delivery was refused' : 'Why your order was cancelled';
    void notify(
      'order_status',
      { accountId: result.order.accountId },
      { title, body: `Order ${code}: ${maskPii(reason)}`, data: { type: 'order', id } },
    );
  }

  const items = await db
    .select()
    .from(mealOrderItems)
    .where(eq(mealOrderItems.orderId, id));

  return json({ order: serializePartnerOrder(result.order, items) }, 200);
}
