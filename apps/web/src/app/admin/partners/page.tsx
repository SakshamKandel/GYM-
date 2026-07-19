import { accounts, meals, mealPartners } from '@gym/db';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { loadPartnerAdminSafeguards } from '@/lib/partnerAdminSafeguardsDb';
import { staffFromCookie } from '@/lib/staffSession';
import { PartnersManager } from './_components/PartnersManager';
import type { PartnerRow } from './_components/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin meal-partner roster (plan §2/§7 P6). Guarded by `partners.manage`
 * (super_admin/main_admin bypass only, delegable via override).
 */

async function loadPartners(): Promise<PartnerRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: mealPartners.id,
      accountId: mealPartners.accountId,
      name: mealPartners.name,
      contact: mealPartners.contact,
      phone: mealPartners.phone,
      addressText: mealPartners.addressText,
      serviceAreas: mealPartners.serviceAreas,
      serviceLat: mealPartners.serviceLat,
      serviceLng: mealPartners.serviceLng,
      serviceRadiusKm: mealPartners.serviceRadiusKm,
      acceptsCod: mealPartners.acceptsCod,
      currency: mealPartners.currency,
      isActive: mealPartners.isActive,
      createdAt: mealPartners.createdAt,
      email: accounts.email,
      accountStatus: accounts.status,
    })
    .from(mealPartners)
    .innerJoin(accounts, eq(accounts.id, mealPartners.accountId))
    .orderBy(asc(mealPartners.name));

  const partnerIds = rows.map((r) => r.id);
  const menuCounts = new Map<string, number>();
  const safeguards = await loadPartnerAdminSafeguards(db, partnerIds);

  if (partnerIds.length > 0) {
    const menuRows = await db
      .select({ partnerId: meals.partnerId, n: count() })
      .from(meals)
      .where(and(inArray(meals.partnerId, partnerIds), eq(meals.isDeleted, false)))
      .groupBy(meals.partnerId);
    for (const r of menuRows) menuCounts.set(r.partnerId, Number(r.n));
  }

  return rows.map((r) => {
    const partnerSafeguards = safeguards.get(r.id);
    return {
      ...r,
      createdAt: r.createdAt.toISOString(),
      menuCount: menuCounts.get(r.id) ?? 0,
      activeOrders: partnerSafeguards?.liveOrders.total ?? 0,
      safeguards: partnerSafeguards ?? {
        currencyHistory: {
          menuItems: 0,
          subscriptions: 0,
          billingCycles: 0,
          orders: 0,
          paymentRequests: 0,
        },
        liveOrders: {
          total: 0,
          byStatus: { pending: 0, confirmed: 0, preparing: 0, out_for_delivery: 0 },
        },
      },
    };
  });
}

export default async function AdminPartnersPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('partners.manage')) redirect('/admin');

  const rows = await loadPartners();
  const active = rows.filter((r) => r.isActive).length;
  const totalMenuItems = rows.reduce((sum, r) => sum + r.menuCount, 0);
  const totalActiveOrders = rows.reduce((sum, r) => sum + r.activeOrders, 0);

  return (
    <div style={{ maxWidth: 1200 }}>
      <PageHeader
        title="Meal partners"
        subtitle="Restaurant accounts that fulfill meal-delivery orders. Creating a partner mints its own web-only login — never a generic staff role grant."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Total partners" value={rows.length} />
        <StatTile label="Active" value={active} />
        <StatTile label="Menu items" value={totalMenuItems} />
        <StatTile label="Active orders" value={totalActiveOrders} />
      </div>

      <PartnersManager partners={rows} />
    </div>
  );
}
