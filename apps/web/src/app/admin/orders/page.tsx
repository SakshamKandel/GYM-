import { mealPartners } from '@gym/db';
import type { OrderStatus } from '@gym/shared';
import { asc } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge, Card, CardHeader, PageHeader } from '@/components/console';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '@/lib/format';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { materializeDueOrders } from '@/lib/meals';
import { staffFromCookie } from '@/lib/staffSession';
import { ADMIN_ORDERS_PAGE_SIZE, loadAdminOrders, loadOrderStatusCounts } from './_data';
import { OrdersOversight } from './_components/OrdersOversight';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Meal orders' };
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
        title="Meal orders"
        subtitle="Every meal-delivery order, across every partner, in one place. Force a status or cancel with a reason when a partner can't act."
      />

      <OrderPipeline counts={statusCounts} />

      <OrdersOversight
        initialOrders={orders}
        partners={partners}
        pageSize={ADMIN_ORDERS_PAGE_SIZE}
        canViewMembers={permissions.has('members.read')}
        // Reversing money needs the money permission on top of orders.review —
        // the same pair POST …/force-cancel enforces. Passing it lets the drawer
        // hide an action this operator would only be 403'd for.
        canReverseMoney={permissions.has('payments.review')}
      />
    </div>
  );
}

/**
 * The seven order states, in one frame and one visual language.
 *
 * They used to be six free-standing stat tiles of identical weight, which asked
 * an operator to read all six before learning the only thing this board is for:
 * how much work is still moving. The lifecycle now reads left to right and
 * splits where the work does — "still moving" is what an operator acts on,
 * "finished" is the record — and each state carries the SAME toned chip the
 * table rows and the drawer use, so a status looks like one thing everywhere.
 */
const IN_FLIGHT: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'out_for_delivery'];
const FINISHED: OrderStatus[] = ['delivered', 'cancelled', 'refused'];

function OrderPipeline({ counts }: { counts: Record<OrderStatus, number> }) {
  const live = IN_FLIGHT.reduce((sum, s) => sum + counts[s], 0);
  return (
    <Card padded={false} style={{ marginBottom: 24 }}>
      {/* Deliberately no live dot: this board refreshes when an operator asks
          it to, not on a ticker, and a pulsing "live" marker on a number that
          is minutes old is a promise the page does not keep. */}
      <CardHeader
        title="Still moving"
        action={
          <span className="gt-numeric" style={{ fontSize: 20, color: 'var(--gt-text)' }}>
            {live}
          </span>
        }
      />
      <div style={{ padding: '16px 18px' }}>
        <StatusRow statuses={IN_FLIGHT} counts={counts} />
      </div>
      <div
        style={{
          padding: '12px 18px 16px',
          borderTop: '1px solid var(--gt-border)',
          background: 'var(--gt-surface-sunken)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-faint)',
            marginBottom: 12,
          }}
        >
          Finished
        </div>
        <StatusRow statuses={FINISHED} counts={counts} />
      </div>
    </Card>
  );
}

function StatusRow({
  statuses,
  counts,
}: {
  statuses: OrderStatus[];
  counts: Record<OrderStatus, number>;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(140px, 1fr))`,
        gap: 16,
      }}
    >
      {statuses.map((s) => (
        <div key={s} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span
            className="gt-numeric"
            style={{
              fontSize: 28,
              lineHeight: 1,
              color: counts[s] > 0 ? 'var(--gt-text)' : 'var(--gt-text-faint)',
            }}
          >
            {counts[s]}
          </span>
          <span>
            <Badge tone={ORDER_STATUS_TONE[s]}>{ORDER_STATUS_LABEL[s]}</Badge>
          </span>
        </div>
      ))}
    </div>
  );
}
