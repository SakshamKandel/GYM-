import { PageHeader, StatTile } from '@/components/console';
import { getDb } from '@/lib/db';
import { materializeDueOrders } from '@/lib/meals';
import { OrdersQueue } from '../_components/OrdersQueue';
import { countActiveSubscriptions, loadActiveOrders, requirePartnerPage } from '../_data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Subscriptions fulfillment — the materialized subscription-order view
 * (source='subscription' only). Same queue + advance controls as Today's Orders,
 * narrowed to recurring-plan deliveries so a partner can see and work their
 * standing meal-plan orders separately.
 */
export default async function PartnerSubscriptionsPage() {
  const { partnerId } = await requirePartnerPage();
  const db = getDb();
  await materializeDueOrders(db, { kind: 'partner', partnerId });
  const [orders, activeSubs] = await Promise.all([
    loadActiveOrders(db, partnerId, { source: 'subscription' }),
    countActiveSubscriptions(db, partnerId),
  ]);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Subscriptions"
        subtitle="Standing meal-plan deliveries. These orders are generated automatically from active subscriptions as each slot's cutoff approaches."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Active subscriptions" value={activeSubs} />
        <StatTile label="Upcoming deliveries" value={orders.length} />
      </div>

      <OrdersQueue
        orders={orders}
        emptyTitle="No subscription orders yet"
        emptyDescription="When members subscribe to a recurring plan with your kitchen, their upcoming deliveries appear here automatically."
      />
    </div>
  );
}
