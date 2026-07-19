import { mealOrderEvents, mealOrderItems, mealOrders } from '@gym/db';
import { asc, eq } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { buildOrderReceipt } from '@/lib/meals';

export const runtime = 'nodejs';

/**
 * GET /api/meals/orders/[id]/receipt — the downloadable/shareable invoice for an
 * order (Pack A). Owner-scoped: the order must belong to the caller (404 when the
 * id is unknown, 403 when it belongs to someone else). Returns the frozen receipt
 * shape (order number, itemized fees, tip, total, currency, status, and the
 * append-only status timeline with per-transition notes) built in `lib/meals`.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;
  const db = getDb();

  const [order] = await db.select().from(mealOrders).where(eq(mealOrders.id, id)).limit(1);
  if (!order) return json({ error: 'not_found' }, 404);
  if (order.accountId !== me.id) return json({ error: 'forbidden' }, 403);

  const items = await db
    .select()
    .from(mealOrderItems)
    .where(eq(mealOrderItems.orderId, id));
  const events = await db
    .select()
    .from(mealOrderEvents)
    .where(eq(mealOrderEvents.orderId, id))
    .orderBy(asc(mealOrderEvents.createdAt));

  return json(buildOrderReceipt(order, items, events), 200);
}
