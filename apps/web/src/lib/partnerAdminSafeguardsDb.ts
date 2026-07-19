import {
  mealBillingCycles,
  mealOrders,
  mealPaymentRequests,
  meals,
  mealSubscriptions,
  type Db,
} from '@gym/db';
import { count, countDistinct, eq, inArray, or, sql } from 'drizzle-orm';
import {
  emptyPartnerCurrencyHistory,
  emptyPartnerLiveOrderImpact,
  type PartnerAdminSafeguards,
  PARTNER_LIVE_ORDER_STATUSES,
  summarizePartnerLiveOrders,
} from './partnerAdminSafeguards';

/**
 * Loads mutation blockers for one or more partners in bounded grouped queries.
 * Menu history intentionally includes soft-deleted rows: once a catalog or any
 * financial record exists, changing the account currency would split ledgers.
 */
export async function loadPartnerAdminSafeguards(
  db: Db,
  partnerIds: readonly string[],
): Promise<Map<string, PartnerAdminSafeguards>> {
  const result = new Map<string, PartnerAdminSafeguards>();
  for (const id of partnerIds) {
    result.set(id, {
      currencyHistory: emptyPartnerCurrencyHistory(),
      liveOrders: emptyPartnerLiveOrderImpact(),
    });
  }
  if (partnerIds.length === 0) return result;

  const paymentPartnerId = sql<string>`coalesce(${mealOrders.partnerId}, ${mealSubscriptions.partnerId})`;
  const [menuRows, subscriptionRows, cycleRows, orderRows, paymentRows] = await Promise.all([
    db
      .select({ partnerId: meals.partnerId, count: count() })
      .from(meals)
      .where(inArray(meals.partnerId, [...partnerIds]))
      .groupBy(meals.partnerId),
    db
      .select({ partnerId: mealSubscriptions.partnerId, count: count() })
      .from(mealSubscriptions)
      .where(inArray(mealSubscriptions.partnerId, [...partnerIds]))
      .groupBy(mealSubscriptions.partnerId),
    db
      .select({ partnerId: mealSubscriptions.partnerId, count: count() })
      .from(mealBillingCycles)
      .innerJoin(
        mealSubscriptions,
        eq(mealSubscriptions.id, mealBillingCycles.subscriptionId),
      )
      .where(inArray(mealSubscriptions.partnerId, [...partnerIds]))
      .groupBy(mealSubscriptions.partnerId),
    db
      .select({ partnerId: mealOrders.partnerId, status: mealOrders.status, count: count() })
      .from(mealOrders)
      .where(inArray(mealOrders.partnerId, [...partnerIds]))
      .groupBy(mealOrders.partnerId, mealOrders.status),
    db
      .select({ partnerId: paymentPartnerId, count: countDistinct(mealPaymentRequests.id) })
      .from(mealPaymentRequests)
      .leftJoin(mealOrders, eq(mealOrders.id, mealPaymentRequests.orderId))
      .leftJoin(mealBillingCycles, eq(mealBillingCycles.id, mealPaymentRequests.cycleId))
      .leftJoin(
        mealSubscriptions,
        eq(mealSubscriptions.id, mealBillingCycles.subscriptionId),
      )
      .where(
        or(
          inArray(mealOrders.partnerId, [...partnerIds]),
          inArray(mealSubscriptions.partnerId, [...partnerIds]),
        ),
      )
      .groupBy(paymentPartnerId),
  ]);

  for (const row of menuRows) {
    const entry = result.get(row.partnerId);
    if (entry) entry.currencyHistory.menuItems = Number(row.count);
  }
  for (const row of subscriptionRows) {
    const entry = result.get(row.partnerId);
    if (entry) entry.currencyHistory.subscriptions = Number(row.count);
  }
  for (const row of cycleRows) {
    const entry = result.get(row.partnerId);
    if (entry) entry.currencyHistory.billingCycles = Number(row.count);
  }

  const groupedLiveRows = new Map<string, { status: string; count: number }[]>();
  for (const row of orderRows) {
    const entry = result.get(row.partnerId);
    if (!entry) continue;
    entry.currencyHistory.orders += Number(row.count);
    if ((PARTNER_LIVE_ORDER_STATUSES as readonly string[]).includes(row.status)) {
      const list = groupedLiveRows.get(row.partnerId) ?? [];
      list.push({ status: row.status, count: Number(row.count) });
      groupedLiveRows.set(row.partnerId, list);
    }
  }
  for (const [partnerId, rows] of groupedLiveRows) {
    const entry = result.get(partnerId);
    if (entry) entry.liveOrders = summarizePartnerLiveOrders(rows);
  }
  for (const row of paymentRows) {
    const entry = row.partnerId ? result.get(row.partnerId) : undefined;
    if (entry) entry.currencyHistory.paymentRequests = Number(row.count);
  }

  return result;
}

/** Narrow helper for a single route mutation. */
export async function loadPartnerAdminSafeguard(
  db: Db,
  partnerId: string,
): Promise<PartnerAdminSafeguards> {
  const map = await loadPartnerAdminSafeguards(db, [partnerId]);
  return (
    map.get(partnerId) ?? {
      currencyHistory: emptyPartnerCurrencyHistory(),
      liveOrders: emptyPartnerLiveOrderImpact(),
    }
  );
}
