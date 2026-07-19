import { accounts, mealDisputes, mealOrders, mealPartners } from '@gym/db';
import { DISPUTE_STATUSES, orderNumber, type DisputeStatus } from '@gym/shared';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin dispute queue (Pack E non-delivery rail / WP-8). Every member-raised
 * `meal_disputes` row, joined to its order (order #, delivery date/window,
 * total) and the filing member (email/displayName) — reuses `orders.review`,
 * the same permission that already gates order oversight and the member-side
 * dispute route's staff `notify` target, so no new permission key.
 *
 *  GET ?status=open|reviewing|resolved|rejected|all (default: open+reviewing,
 *  i.e. the live queue) — open/oldest-first within the live set so nothing
 *  ages silently at the back of the list; resolved/rejected/all are
 *  newest-decided-first.
 */

const LIVE = ['open', 'reviewing'] as const;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'orders.review');
  if (principal instanceof Response) return principal;

  const statusParam = new URL(req.url).searchParams.get('status');
  const showAll = statusParam === 'all';
  const status =
    !showAll && statusParam && (DISPUTE_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as DisputeStatus)
      : undefined;

  const db = getDb();
  const rows = await db
    .select({
      id: mealDisputes.id,
      orderId: mealDisputes.orderId,
      accountId: mealDisputes.accountId,
      accountEmail: accounts.email,
      accountDisplayName: accounts.displayName,
      reason: mealDisputes.reason,
      note: mealDisputes.note,
      status: mealDisputes.status,
      resolution: mealDisputes.resolution,
      createdAt: mealDisputes.createdAt,
      decidedAt: mealDisputes.decidedAt,
      orderTotalMinor: mealOrders.totalMinor,
      orderCurrency: mealOrders.currency,
      orderStatus: mealOrders.status,
      orderPaymentStatus: mealOrders.paymentStatus,
      orderDeliveryDate: mealOrders.deliveryDate,
      orderWindow: mealOrders.window,
      partnerName: mealPartners.name,
    })
    .from(mealDisputes)
    .innerJoin(mealOrders, eq(mealOrders.id, mealDisputes.orderId))
    .innerJoin(accounts, eq(accounts.id, mealDisputes.accountId))
    .innerJoin(mealPartners, eq(mealPartners.id, mealOrders.partnerId))
    .where(status ? eq(mealDisputes.status, status) : showAll ? undefined : inArray(mealDisputes.status, LIVE))
    .orderBy(status || showAll ? desc(mealDisputes.createdAt) : asc(mealDisputes.createdAt))
    .limit(300);

  return json(
    {
      disputes: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        orderNumber: orderNumber(r.orderId),
        account: { id: r.accountId, email: r.accountEmail, displayName: r.accountDisplayName },
        partnerName: r.partnerName,
        order: {
          totalMinor: r.orderTotalMinor,
          currency: r.orderCurrency,
          status: r.orderStatus,
          paymentStatus: r.orderPaymentStatus,
          deliveryDate: r.orderDeliveryDate,
          window: r.orderWindow,
        },
        reason: r.reason,
        note: r.note,
        status: r.status,
        resolution: r.resolution,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      })),
    },
    200,
  );
}
