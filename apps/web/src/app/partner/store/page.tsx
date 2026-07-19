import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { StoreControls } from '../_components/StoreControls';
import { deriveStoreState, loadPartnerMenu, requirePartnerPage } from '../_data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Store controls — the accepting-orders switch and per-item out-of-stock grid.
 * Store pause is partner-level; individual item availability remains intact.
 * Member create routes enforce both flags server-side.
 */
export default async function PartnerStorePage() {
  const { partnerId, currency, acceptingOrders } = await requirePartnerPage();
  const menu = await loadPartnerMenu(getDb(), partnerId);
  const store = deriveStoreState(menu, acceptingOrders);

  return (
    <div>
      <PageHeader
        title="Store controls"
        subtitle="Pause new orders while you are away, or mark individual dishes out of stock."
      />
      <StoreControls menu={menu} store={store} currency={currency} />
    </div>
  );
}
