import { mealOrderItems, mealOrders } from '@gym/db';
import {
  ORDER_STATUSES,
  canActorAdvance,
  orderPaymentMutationBlock,
  type OrderStatus,
} from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { advanceOrderStatus } from '@/lib/meals';
import { serializePartnerOrder } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner order status advance (§3). The ONE fulfillment transition a partner can
 * drive. Layered guards:
 *  1. requirePartner → the caller's OWN partnerId (scope). A foreign order id is
 *     never found under this scope → 404 (indistinguishable from "doesn't exist",
 *     no IDOR oracle).
 *  2. canActorAdvance(from, to, 'partner') — structural legality + partner
 *     authority (a partner may NOT, e.g., cancel a `preparing` order; only admin
 *     can).
 *  3. Payment gate: pending→confirmed only when the order is already paid (digital
 *     receipt approved) OR is COD (reconciled on delivery).
 *  4. The atomic CAS write (advanceOrderStatus) with `scope.partnerId` folded into
 *     the WHERE — a lost race or scope-miss both yield 409, never a 200.
 */

const bodySchema = z.object({
  toStatus: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]),
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
  const { toStatus } = parsed.data;

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
  if (!canActorAdvance(from, toStatus, 'partner')) {
    return json({ error: 'illegal_transition' }, 409);
  }

  if (toStatus === 'cancelled' || toStatus === 'refused') {
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
  });
  if (!result.ok) return json({ error: 'conflict' }, 409);

  const items = await db
    .select()
    .from(mealOrderItems)
    .where(eq(mealOrderItems.orderId, id));

  return json({ order: serializePartnerOrder(result.order, items) }, 200);
}
