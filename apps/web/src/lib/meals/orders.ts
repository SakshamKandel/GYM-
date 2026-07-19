import type { mealOrderEvents, mealOrderItems, mealOrders } from '@gym/db';
import {
  computeFees,
  maskPii,
  orderNumber,
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
type EventRow = typeof mealOrderEvents.$inferSelect;

/** A priced line as the client submits it (qty × the server-resolved price). */
export interface PricedLine {
  priceMinor: number;
  qty: number;
}

/**
 * Server-authoritative subtotal + fee + tip breakdown for a one-time order. The
 * optional `tipMinor` (Pack D) is folded into `totalMinor` — it MUST already have
 * passed `validateTipMinor` at the route (this helper only trusts it enough to
 * floor negatives/NaN, never to bound-check). `totalMinor` stays the single
 * authoritative sum the create route freezes and the price-change guard compares.
 */
export function computeOrderFinancials(
  lines: readonly PricedLine[],
  cfg: MealDeliveryConfig,
  tipMinor = 0,
): {
  subtotalMinor: number;
  deliveryFeeMinor: number;
  smallOrderFeeMinor: number;
  tipMinor: number;
  totalMinor: number;
} {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.priceMinor * l.qty, 0);
  const { deliveryFeeMinor, smallOrderFeeMinor, totalMinor } = computeFees(subtotalMinor, cfg);
  const safeTip = Number.isFinite(tipMinor) ? Math.max(0, Math.trunc(tipMinor)) : 0;
  return {
    subtotalMinor,
    deliveryFeeMinor,
    smallOrderFeeMinor,
    tipMinor: safeTip,
    totalMinor: totalMinor + safeTip,
  };
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
    // Human-readable code for the confirmation screen / tracking / support (the
    // id remains authoritative; this is display only, stable for a given id).
    orderNumber: orderNumber(order.id),
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
    tipMinor: order.tipMinor,
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
 * The downloadable/shareable receipt/invoice for an order (Pack A). Frozen
 * contract consumed by `GET /api/meals/orders/[id]/receipt` (WP-3) and rendered
 * by the member app + partner/admin drawers (WP-6/WP-7/WP-8). Owner-scoped: the
 * route resolves the order under `accountId = me.id` before calling this. The
 * `timeline` is the append-only status audit (oldest-first), each row carrying
 * its per-transition `note` (refuse/cancel reason) when present.
 */
export function buildOrderReceipt(
  order: OrderRow,
  items: readonly ItemRow[],
  events: readonly EventRow[],
) {
  return {
    orderNumber: orderNumber(order.id),
    placedAt: order.placedAt,
    items: items.map((item) => ({
      name: item.nameSnapshot,
      qty: item.qty,
      priceMinorSnapshot: item.priceMinorSnapshot,
    })),
    subtotalMinor: order.subtotalMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    smallOrderFeeMinor: order.smallOrderFeeMinor,
    tipMinor: order.tipMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    status: order.status,
    timeline: events.map((event) => ({
      status: event.toStatus,
      at: event.createdAt,
      note: event.note ?? null,
    })),
  };
}

/**
 * The STRICT partner projection (§2). Delivery-necessary fields only: NEVER the
 * member's accountId, email, tier, displayName-as-identity, or their other
 * orders. Structured delivery fields are shown raw (masking them breaks
 * delivery); free-text `deliveryNotes` is re-masked (anti-poaching, idempotent
 * over the maskPii already applied at store). Exported for P5's partner routes
 * so isolation lives in one audited place.
 *
 * The geocoded delivery pin (lat/lng) is legitimate partner-facing delivery data
 * for rider navigation. It reads from the frozen order snapshot; `fallback`
 * supplies the live saved-address coords for pre-snapshot orders (resolved by a
 * read-time left join) and is used only when the snapshot column is null.
 */
export function buildPartnerOrderView(
  order: OrderRow,
  items: readonly ItemRow[],
  fallback?: { lat: number | null; lng: number | null },
) {
  return {
    orderId: order.id,
    status: order.status,
    placedAt: order.placedAt,
    deliveryDate: order.deliveryDate,
    window: order.window,
    deliveryName: order.deliveryName,
    deliveryPhone: order.deliveryPhone,
    deliveryAddressText: order.deliveryAddressText,
    deliveryLat: order.deliveryLat ?? fallback?.lat ?? null,
    deliveryLng: order.deliveryLng ?? fallback?.lng ?? null,
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
