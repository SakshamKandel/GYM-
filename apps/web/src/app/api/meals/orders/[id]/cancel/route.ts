import { mealOrderItems, mealOrders } from '@gym/db';
import { canActorAdvance, maskPii, orderPaymentMutationBlock } from '@gym/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { advanceOrderStatus, buildMemberOrderView } from '@/lib/meals';

export const runtime = 'nodejs';

/**
 * Member order cancellation (§3). A member may cancel only a PENDING order and
 * only BEFORE its frozen cutoff (`now < cutoffAt`) — the fulfillment actor
 * matrix forbids members from cancelling a confirmed/preparing order (that's a
 * partner/admin decision). The advance is a CAS scoped to the caller's
 * accountId, so a lost race or a foreign id both surface as a 404/409, never a
 * partial mutation.
 */

const bodySchema = z.object({ reason: z.string().trim().max(300).optional() });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const [order] = await db
    .select({
      id: mealOrders.id,
      status: mealOrders.status,
      paymentStatus: mealOrders.paymentStatus,
      cutoffAt: mealOrders.cutoffAt,
    })
    .from(mealOrders)
    .where(and(eq(mealOrders.id, id), eq(mealOrders.accountId, me.id)))
    .limit(1);
  if (!order) return json({ error: 'not_found' }, 404);

  // Structural + actor legality (members may cancel only from 'pending').
  if (!canActorAdvance(order.status, 'cancelled', 'member')) {
    return json({ error: 'not_cancellable' }, 409);
  }
  const paymentBlock = orderPaymentMutationBlock(order.paymentStatus);
  if (paymentBlock) return json({ error: paymentBlock }, 409);
  // Member cancels are cutoff-bound (invariant §8c).
  if (new Date().getTime() >= order.cutoffAt.getTime()) {
    return json({ error: 'past_cutoff' }, 400);
  }

  const result = await advanceOrderStatus({
    db,
    orderId: order.id,
    expectedStatus: order.status,
    toStatus: 'cancelled',
    actor: 'member',
    actorId: me.id,
    scope: { accountId: me.id },
    cancelReason: parsed.data.reason ? maskPii(parsed.data.reason) : 'Cancelled by member',
  });
  if (!result.ok) return json({ error: 'conflict' }, 409);

  const items = await db
    .select()
    .from(mealOrderItems)
    .where(inArray(mealOrderItems.orderId, [result.order.id]));

  return json({ order: buildMemberOrderView(result.order, items) }, 200);
}
