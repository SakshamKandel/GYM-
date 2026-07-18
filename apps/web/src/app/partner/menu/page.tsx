import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { MenuManager } from '../_components/MenuManager';
import { loadPartnerMenu, requirePartnerPage } from '../_data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Menu — the partner's own menu-item CRUD (create/edit/soft-delete, availability
 * slots, and an optional photo per item). All writes are scoped server-side to
 * the caller's own partnerId via the /api/partner/meals routes.
 */
export default async function PartnerMenuPage() {
  const { partnerId, currency } = await requirePartnerPage();
  const items = await loadPartnerMenu(getDb(), partnerId);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Menu"
        subtitle="Your menu items. Members browse and order these; prices and macros are shown to them exactly as you set them here."
      />
      <MenuManager items={items} defaultCurrency={currency === 'USD' ? 'USD' : 'NPR'} />
    </div>
  );
}
