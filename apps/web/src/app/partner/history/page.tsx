import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { OrdersQueue } from '../_components/OrdersQueue';
import { loadHistoryOrders, requirePartnerPage } from '../_data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Order history — completed and closed orders (delivered / cancelled / refused),
 * newest first. Read-only: terminal orders offer no advance controls, so the
 * shared queue renders them without an action bar.
 */
export default async function PartnerHistoryPage() {
  const { partnerId } = await requirePartnerPage();
  const orders = await loadHistoryOrders(getDb(), partnerId);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Order History"
        subtitle="Delivered, cancelled, and refused orders. This is a read-only record for your reference."
      />
      <OrdersQueue
        orders={orders}
        emptyTitle="No past orders yet"
        emptyDescription="Once orders are delivered or closed, they'll be listed here."
      />
    </div>
  );
}
