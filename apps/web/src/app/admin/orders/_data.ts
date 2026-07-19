import 'server-only';

import {
  accounts,
  mealOrderItems,
  mealOrders,
  mealPartners,
  savedAddresses,
  type Db,
} from '@gym/db';
import {
  TERMINAL_ORDER_STATUSES,
  type MealCurrency,
  type MealPaymentMethod,
  type MealWindow,
  type OrderStatus,
} from '@gym/shared';
import { and, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';

/** Escapes ILIKE metacharacters (mirrors `/api/admin/members`'s helper) so a
 * literal '%'/'_' in the search box can't widen or corrupt the match. */
function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, '\\$&');
}

/**
 * Server-only data layer for admin order oversight (plan §2/§3/§7 P6). Unlike
 * the partner projection (`buildPartnerOrderView`, which strips member
 * identity), admin oversight is fully-trusted — the member's accountId, email,
 * and display name ARE included, since this surface exists precisely for
 * cross-partner support/dispute resolution.
 */

export interface AdminOrderRow {
  id: string;
  partnerId: string;
  partnerName: string;
  accountId: string;
  accountEmail: string;
  accountDisplayName: string;
  source: 'one_time' | 'subscription';
  deliveryDate: string;
  window: MealWindow;
  status: OrderStatus;
  paymentMethod: MealPaymentMethod;
  paymentStatus: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  smallOrderFeeMinor: number;
  totalMinor: number;
  currency: MealCurrency;
  deliveryName: string;
  deliveryPhone: string;
  deliveryAddressText: string;
  deliveryNotes: string;
  // Geocoded delivery point, from the frozen order snapshot; falls back to the
  // linked saved address's live coords when the snapshot is null (pre-snapshot
  // orders). Nullable: legacy orders, deleted addresses, or never pinned.
  deliveryLat: number | null;
  deliveryLng: number | null;
  cutoffAt: string;
  placedAt: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: { name: string; qty: number; priceMinorSnapshot: number }[];
}

export interface AdminOrderFilters {
  date?: string;
  partnerId?: string;
  status?: OrderStatus;
  scope: 'active' | 'history' | 'all';
  /** Free-text search over partner name / member email / member display name
   * (B14 — matched server-side against the FULL table, not just the already-
   * fetched page). */
  q?: string;
}

/** All-partner order oversight (§3/§7 "filters by date/partner/status"). */
export async function loadAdminOrders(
  db: Db,
  filters: AdminOrderFilters,
): Promise<AdminOrderRow[]> {
  const predicates = [];
  if (filters.date) predicates.push(eq(mealOrders.deliveryDate, filters.date));
  if (filters.partnerId) predicates.push(eq(mealOrders.partnerId, filters.partnerId));
  if (filters.status) predicates.push(eq(mealOrders.status, filters.status));
  const terminal = [...TERMINAL_ORDER_STATUSES];
  if (filters.scope === 'active') predicates.push(notInArray(mealOrders.status, terminal));
  if (filters.scope === 'history') predicates.push(inArray(mealOrders.status, terminal));
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    predicates.push(
      or(
        ilike(mealPartners.name, like),
        ilike(accounts.email, like),
        ilike(accounts.displayName, like),
      )!,
    );
  }

  const rows = await db
    .select({
      order: mealOrders,
      partnerName: mealPartners.name,
      accountEmail: accounts.email,
      accountDisplayName: accounts.displayName,
      addrLat: savedAddresses.lat,
      addrLng: savedAddresses.lng,
    })
    .from(mealOrders)
    .innerJoin(mealPartners, eq(mealPartners.id, mealOrders.partnerId))
    .innerJoin(accounts, eq(accounts.id, mealOrders.accountId))
    .leftJoin(savedAddresses, eq(savedAddresses.id, mealOrders.addressId))
    .where(predicates.length > 0 ? and(...predicates) : undefined)
    .orderBy(desc(mealOrders.placedAt))
    .limit(300);

  if (rows.length === 0) return [];

  const orderIds = rows.map((r) => r.order.id);
  const itemRows = await db
    .select()
    .from(mealOrderItems)
    .where(inArray(mealOrderItems.orderId, orderIds));
  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const it of itemRows) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    list.push(it);
    itemsByOrder.set(it.orderId, list);
  }

  return rows.map((r) => {
    const o = r.order;
    return {
      id: o.id,
      partnerId: o.partnerId,
      partnerName: r.partnerName,
      accountId: o.accountId,
      accountEmail: r.accountEmail,
      accountDisplayName: r.accountDisplayName,
      source: o.source,
      deliveryDate: o.deliveryDate,
      window: o.window,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      subtotalMinor: o.subtotalMinor,
      deliveryFeeMinor: o.deliveryFeeMinor,
      smallOrderFeeMinor: o.smallOrderFeeMinor,
      totalMinor: o.totalMinor,
      currency: o.currency,
      deliveryName: o.deliveryName,
      deliveryPhone: o.deliveryPhone,
      deliveryAddressText: o.deliveryAddressText,
      deliveryNotes: o.deliveryNotes,
      deliveryLat: o.deliveryLat ?? r.addrLat,
      deliveryLng: o.deliveryLng ?? r.addrLng,
      cutoffAt: o.cutoffAt.toISOString(),
      placedAt: o.placedAt.toISOString(),
      confirmedAt: o.confirmedAt ? o.confirmedAt.toISOString() : null,
      deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
      cancelledAt: o.cancelledAt ? o.cancelledAt.toISOString() : null,
      cancelReason: o.cancelReason,
      items: (itemsByOrder.get(o.id) ?? []).map((it) => ({
        name: it.nameSnapshot,
        qty: it.qty,
        priceMinorSnapshot: it.priceMinorSnapshot,
      })),
    };
  });
}

/** Global status counts (unfiltered) for the page's stat tiles. */
export async function loadOrderStatusCounts(db: Db): Promise<Record<OrderStatus, number>> {
  const rows = await db
    .select({ status: mealOrders.status, n: sql<string>`count(*)::text` })
    .from(mealOrders)
    .groupBy(mealOrders.status);
  const base: Record<OrderStatus, number> = {
    pending: 0,
    confirmed: 0,
    preparing: 0,
    out_for_delivery: 0,
    delivered: 0,
    cancelled: 0,
    refused: 0,
  };
  for (const r of rows) base[r.status as OrderStatus] = Number(r.n);
  return base;
}
