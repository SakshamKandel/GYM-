import type { mealOrderItems, mealOrders } from '@gym/db';
import {
  computeFees,
  maskPii,
  type MealDeliveryConfig,
} from '@gym/shared';

/**
 * Order financial + serialization helpers. Fees are ALWAYS recomputed from the
 * server config here (invariant §8: the client never sets price/fees). The
 * partner projection is the single chokepoint that strips member identity
 * (§2 / invariant §8f) — no route should serialize a raw order to a partner.
 */

type OrderRow = typeof mealOrders.$inferSelect;
type ItemRow = typeof mealOrderItems.$inferSelect;

/** A priced line as the client submits it (qty × the server-resolved price). */
export interface PricedLine {
  priceMinor: number;
  qty: number;
}

/** Server-authoritative subtotal + fee breakdown for a one-time order. */
export function computeOrderFinancials(
  lines: readonly PricedLine[],
  cfg: MealDeliveryConfig,
): { subtotalMinor: number; deliveryFeeMinor: number; smallOrderFeeMinor: number; totalMinor: number } {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.priceMinor * l.qty, 0);
  const { deliveryFeeMinor, smallOrderFeeMinor, totalMinor } = computeFees(subtotalMinor, cfg);
  return { subtotalMinor, deliveryFeeMinor, smallOrderFeeMinor, totalMinor };
}

/** One line item as serialized to the MEMBER (macros included). */
function memberItemView(item: ItemRow) {
  return {
    mealId: item.mealId,
    name: item.nameSnapshot,
    priceMinorSnapshot: item.priceMinorSnapshot,
    macros: item.macrosSnapshot,
    qty: item.qty,
  };
}

/**
 * The full order as its OWNER (member) may see it — every financial + status
 * field plus line items. Safe because the caller has already scoped the query
 * to `accountId = me.id`.
 */
export function buildMemberOrderView(order: OrderRow, items: readonly ItemRow[]) {
  return {
    id: order.id,
    source: order.source,
    partnerId: order.partnerId,
    subscriptionId: order.subscriptionId,
    deliveryDate: order.deliveryDate,
    window: order.window,
    deliveryName: order.deliveryName,
    deliveryPhone: order.deliveryPhone,
    deliveryAddressText: order.deliveryAddressText,
    deliveryNotes: order.deliveryNotes,
    subtotalMinor: order.subtotalMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    smallOrderFeeMinor: order.smallOrderFeeMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    cutoffAt: order.cutoffAt,
    placedAt: order.placedAt,
    confirmedAt: order.confirmedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    items: items.map(memberItemView),
  };
}

/**
 * The STRICT partner projection (§2). Delivery-necessary fields only: NEVER the
 * member's accountId, email, tier, displayName-as-identity, or their other
 * orders. Structured delivery fields are shown raw (masking them breaks
 * delivery); free-text `deliveryNotes` is re-masked (anti-poaching, idempotent
 * over the maskPii already applied at store). Exported for P5's partner routes
 * so isolation lives in one audited place.
 */
export function buildPartnerOrderView(order: OrderRow, items: readonly ItemRow[]) {
  return {
    orderId: order.id,
    status: order.status,
    placedAt: order.placedAt,
    deliveryDate: order.deliveryDate,
    window: order.window,
    deliveryName: order.deliveryName,
    deliveryPhone: order.deliveryPhone,
    deliveryAddressText: order.deliveryAddressText,
    deliveryNotes: maskPii(order.deliveryNotes),
    items: items.map((item) => ({
      name: item.nameSnapshot,
      qty: item.qty,
      priceMinorSnapshot: item.priceMinorSnapshot,
    })),
    totalMinor: order.totalMinor,
    currency: order.currency,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
  };
}
