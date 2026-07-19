import type { OrderStatus } from '@gym/shared';

export const PARTNER_LIVE_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
] as const satisfies readonly OrderStatus[];

export type PartnerLiveOrderStatus = (typeof PARTNER_LIVE_ORDER_STATUSES)[number];

export interface PartnerCurrencyHistory {
  menuItems: number;
  subscriptions: number;
  billingCycles: number;
  orders: number;
  paymentRequests: number;
}

export interface PartnerLiveOrderImpact {
  total: number;
  byStatus: Record<PartnerLiveOrderStatus, number>;
}

export interface PartnerAdminSafeguards {
  currencyHistory: PartnerCurrencyHistory;
  liveOrders: PartnerLiveOrderImpact;
}

export function emptyPartnerCurrencyHistory(): PartnerCurrencyHistory {
  return {
    menuItems: 0,
    subscriptions: 0,
    billingCycles: 0,
    orders: 0,
    paymentRequests: 0,
  };
}

export function emptyPartnerLiveOrderImpact(): PartnerLiveOrderImpact {
  return {
    total: 0,
    byStatus: {
      pending: 0,
      confirmed: 0,
      preparing: 0,
      out_for_delivery: 0,
    },
  };
}

export function hasPartnerCurrencyHistory(history: PartnerCurrencyHistory): boolean {
  return Object.values(history).some((count) => count > 0);
}

export function partnerCurrencyChangeBlocked(
  currentCurrency: string,
  requestedCurrency: string | undefined,
  history: PartnerCurrencyHistory,
): boolean {
  return (
    requestedCurrency !== undefined &&
    requestedCurrency !== currentCurrency &&
    hasPartnerCurrencyHistory(history)
  );
}

/** Stable status summary from grouped database rows. Unknown/terminal rows are ignored. */
export function summarizePartnerLiveOrders(
  rows: readonly { status: string; count: number }[],
): PartnerLiveOrderImpact {
  const impact = emptyPartnerLiveOrderImpact();
  for (const row of rows) {
    if (!(PARTNER_LIVE_ORDER_STATUSES as readonly string[]).includes(row.status)) continue;
    const status = row.status as PartnerLiveOrderStatus;
    const count = Number.isFinite(row.count) && row.count > 0 ? Math.floor(row.count) : 0;
    impact.byStatus[status] += count;
    impact.total += count;
  }
  return impact;
}

