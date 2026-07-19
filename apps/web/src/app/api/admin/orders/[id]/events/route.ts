import { mealOrderEvents, mealOrders } from '@gym/db';
import { asc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin order-drawer timeline (Pack I-timeline / WP-8). Read-only who/why/when
 * audit trail for one order: every append-only `meal_order_events` row
 * (from→to, actor role, actor id, timestamp), oldest first. Guarded by the
 * SAME `orders.review` permission as the oversight board and override route —
 * this is a sibling read of data those routes already expose piecemeal.
 *
 * The order's own `cancelReason` (the terminal cancel/refuse reason — see B13)
 * is surfaced separately by the existing `AdminOrderRow.cancelReason` field;
 * this endpoint only adds the step-by-step transition history around it.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'orders.review');
  if (principal instanceof Response) return principal;

  const { id } = await ctx.params;

  const db = getDb();
  const [order] = await db
    .select({ id: mealOrders.id })
    .from(mealOrders)
    .where(eq(mealOrders.id, id))
    .limit(1);
  if (!order) return json({ error: 'not_found' }, 404);

  const rows = await db
    .select({
      id: mealOrderEvents.id,
      fromStatus: mealOrderEvents.fromStatus,
      toStatus: mealOrderEvents.toStatus,
      actorId: mealOrderEvents.actorId,
      actorRole: mealOrderEvents.actorRole,
      note: mealOrderEvents.note,
      createdAt: mealOrderEvents.createdAt,
    })
    .from(mealOrderEvents)
    .where(eq(mealOrderEvents.orderId, id))
    .orderBy(asc(mealOrderEvents.createdAt));

  return json(
    {
      events: rows.map((r) => ({
        id: r.id,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        actorRole: r.actorRole,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    200,
  );
}
