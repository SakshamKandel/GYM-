import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { StoreControls } from '../_components/StoreControls';
import { deriveStoreState, loadPartnerMenu, requirePartnerPage } from '../_data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Store controls — the accepting-orders switch and per-item out-of-stock grid.
 * Both operate on `meals.isActive`, the flag the member order-create route
 * already requires for every line, so pausing blocks new orders server-side
 * with no schema change and no member-route edit (see /api/partner/store).
 */
export default async function PartnerStorePage() {
  const { partnerId, currency } = await requirePartnerPage();
  const menu = await loadPartnerMenu(getDb(), partnerId);
  const store = deriveStoreState(menu);

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
