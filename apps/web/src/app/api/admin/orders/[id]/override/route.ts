import { mealOrders } from '@gym/db';
import {
  ORDER_STATUSES,
  canActorAdvance,
  orderPaymentMutationBlock,
  type OrderStatus,
} from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { advanceOrderStatus } from '@/lib/meals';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin cross-partner order override (plan §3 transition table's admin rows,
 * incl. "any non-terminal → cancelled | override"). Guarded by `orders.review`.
 *
 * This route does NOT bypass the structural fulfillment machine — legality
 * still funnels through `canActorAdvance(from, to, 'admin')`, so it can only
 * exercise transitions the admin actor is actually permitted (forward steps a
 * partner missed, or a cancel/refuse an ordinary partner transition can't
 * reach, e.g. cancelling an already out_for_delivery order). The atomic CAS
 * write, append-only event, and member push are the SAME shared path the
 * member/partner routes use (`advanceOrderStatus`) — no separate, divergent
 * admin write path to keep in sync.
 */

const bodySchema = z.object({
  toStatus: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]),
  reason: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'orders.review');
  if (principal instanceof Response) return principal;

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { toStatus, reason } = parsed.data;

  const db = getDb();
  const [order] = await db
    .select({
      status: mealOrders.status,
      paymentMethod: mealOrders.paymentMethod,
      paymentStatus: mealOrders.paymentStatus,
    })
    .from(mealOrders)
    .where(eq(mealOrders.id, id))
    .limit(1);
  if (!order) return json({ error: 'not_found' }, 404);

  const from = order.status;
  if (!canActorAdvance(from, toStatus, 'admin')) {
    return json({ error: 'illegal_transition' }, 409);
  }

  if (toStatus === 'cancelled' || toStatus === 'refused') {
    const paymentBlock = orderPaymentMutationBlock(order.paymentStatus);
    if (paymentBlock) return json({ error: paymentBlock }, 409);
  }

  // Payment gate (§3): the "never cook unpaid" invariant applies to the admin
  // path too — a pending→confirmed override still requires an approved digital
  // receipt (paymentStatus='paid') or COD. canActorAdvance only answers the
  // structural question; this route owns the extra guard (mirrors the partner
  // advance route).
  if (toStatus === 'confirmed') {
    const paid = order.paymentStatus === 'paid' || order.paymentMethod === 'cod';
    if (!paid) return json({ error: 'payment_required' }, 409);
  }

  const result = await advanceOrderStatus({
    db,
    orderId: id,
    expectedStatus: from,
    toStatus,
    actor: 'admin',
    actorId: principal.id,
    cancelReason: toStatus === 'cancelled' ? (reason ?? null) : undefined,
  });
  if (!result.ok) return json({ error: 'conflict' }, 409);

  await logAudit(
    principal,
    'order.override',
    'meal_orders',
    id,
    { from, to: toStatus, reason: reason ?? null },
    clientIp(req),
  );

  return json({ ok: true }, 200);
}
