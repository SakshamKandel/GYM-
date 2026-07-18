import { mealPartners } from '@gym/db';
import { asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { materializeDueOrders } from '@/lib/meals';
import { staffFromCookie } from '@/lib/staffSession';
import { loadAdminOrders, loadOrderStatusCounts } from './_data';
import { OrdersOversight } from './_components/OrdersOversight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin all-partner order oversight (plan §2/§3/§7 P6). Guarded by
 * `orders.review` (super_admin/main_admin bypass only, delegable via
 * override). Loads the active queue + global status counts server-side;
 * filter changes in the client component re-fetch the guarded API route.
 */

export default async function AdminOrdersPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('orders.review')) redirect('/admin');

  const db = getDb();
  // Viewing the board is a materialization trigger point too (§3).
  await materializeDueOrders(db, { kind: 'all' });

  const [orders, statusCounts, partners] = await Promise.all([
    loadAdminOrders(db, { scope: 'active' }),
    loadOrderStatusCounts(db),
    db
      .select({ id: mealPartners.id, name: mealPartners.name })
      .from(mealPartners)
      .orderBy(asc(mealPartners.name)),
  ]);

  return (
    <div style={{ maxWidth: 1280 }}>
      <PageHeader
        title="Order oversight"
        subtitle="Every meal-delivery order, across every partner, in one place. Force a status or cancel with a reason when a partner can't act."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Pending" value={statusCounts.pending} />
        <StatTile label="Confirmed" value={statusCounts.confirmed} />
        <StatTile label="Preparing" value={statusCounts.preparing} />
        <StatTile label="Out for delivery" value={statusCounts.out_for_delivery} />
        <StatTile label="Delivered" value={statusCounts.delivered} />
        <StatTile label="Cancelled / refused" value={statusCounts.cancelled + statusCounts.refused} />
      </div>

      <OrdersOversight initialOrders={orders} partners={partners} />
    </div>
  );
}
