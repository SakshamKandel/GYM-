import { mealOrderItems, mealOrders } from '@gym/db';
import { validateTipMinor } from '@gym/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { buildMemberOrderView } from '@/lib/meals';

export const runtime = 'nodejs';

/**
 * POST /api/meals/orders/[id]/tip — set a server-repriced gratuity on an order
 * (Pack D). The client `tipMinor` is only a hint: {@link validateTipMinor} bounds
 * it (integer, ≥0, ≤ cap; §7.2-S5) before it touches the total.
 *
 * Money-safety: a tip may only be set while the order is still `unpaid` (an
 * already-captured or refunded total must never be silently changed) and not on
 * a cancelled/refused order. The write is a CAS on `(accountId, statusVersion,
 * paymentStatus)` so a concurrent status/payment advance makes the tip a 409
 * rather than corrupting a settled total; setting a tip is an ABSOLUTE overwrite,
 * so a double-tap re-applies the same value (never doubles it).
 */

const bodySchema = z.object({ tipMinor: z.number().int().min(0) });

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
      subtotalMinor: mealOrders.subtotalMinor,
      deliveryFeeMinor: mealOrders.deliveryFeeMinor,
      smallOrderFeeMinor: mealOrders.smallOrderFeeMinor,
      statusVersion: mealOrders.statusVersion,
      status: mealOrders.status,
      paymentStatus: mealOrders.paymentStatus,
    })
    .from(mealOrders)
    .where(and(eq(mealOrders.id, id), eq(mealOrders.accountId, me.id)))
    .limit(1);
  if (!order) return json({ error: 'not_found' }, 404);
  if (order.status === 'cancelled' || order.status === 'refused') {
    return json({ error: 'tip_locked' }, 409);
  }
  if (order.paymentStatus !== 'unpaid') return json({ error: 'tip_locked' }, 409);

  const check = validateTipMinor(parsed.data.tipMinor, order.subtotalMinor);
  if (!check.ok) return json({ error: 'invalid_tip', reason: check.reason }, 400);

  const newTotal =
    order.subtotalMinor + order.deliveryFeeMinor + order.smallOrderFeeMinor + check.tipMinor;

  const updated = await db
    .update(mealOrders)
    .set({ tipMinor: check.tipMinor, totalMinor: newTotal, updatedAt: new Date() })
    .where(
      and(
        eq(mealOrders.id, order.id),
        eq(mealOrders.accountId, me.id),
        eq(mealOrders.statusVersion, order.statusVersion),
        eq(mealOrders.paymentStatus, 'unpaid'),
      ),
    )
    .returning();
  if (updated.length === 0) return json({ error: 'conflict' }, 409);

  const items = await db
    .select()
    .from(mealOrderItems)
    .where(inArray(mealOrderItems.orderId, [order.id]));

  return json({ order: buildMemberOrderView(updated[0], items) }, 200);
}
