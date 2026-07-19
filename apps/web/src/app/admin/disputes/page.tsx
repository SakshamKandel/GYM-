import { accounts, mealDisputes, mealOrders, mealPartners } from '@gym/db';
import { orderNumber } from '@gym/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { DisputesQueue, type DisputeRow } from './_components/DisputesQueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin dispute queue (Pack E non-delivery rail / WP-8). Guarded by
 * `orders.review` — the same permission that already gates order oversight
 * and the target of the member-side dispute route's staff `notify`. Loads the
 * live queue (open + reviewing) server-side; the client component's tabs
 * switch to decided disputes without an extra round trip (dispute volume is
 * small, same non-paginated shape as the Support inbox).
 */

const LIVE = ['open', 'reviewing'] as const;

export default async function AdminDisputesPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('orders.review')) redirect('/admin');

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
    .where(inArray(mealDisputes.status, LIVE))
    .orderBy(asc(mealDisputes.createdAt))
    .limit(300);

  const disputes: DisputeRow[] = rows.map((r) => ({
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
  }));

  const openCount = disputes.filter((d) => d.status === 'open').length;
  const reviewingCount = disputes.filter((d) => d.status === 'reviewing').length;

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Disputes"
        subtitle="Every member-reported problem with a delivered order. Resolving here never moves money automatically — issue a refund from Meal Payments first if one is owed."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Open" value={openCount} />
        <StatTile label="Reviewing" value={reviewingCount} />
        <StatTile label="Live total" value={disputes.length} />
      </div>

      <DisputesQueue disputes={disputes} />
    </div>
  );
}
