/**
 * Meal-delivery engine runtime (§3 / P3). Cutoff + fee + status-machine PURE
 * logic lives in @gym/shared; this module is the DB-bound engine consumed by the
 * member routes here and by the partner (P5) and admin (P6) routes:
 *
 *  - config       — server-authoritative fee/cutoff singleton loader
 *  - orders       — fee computation + member/partner order serialization
 *  - advance      — the one race-safe CAS status-advance path (+ event + push)
 *  - materialize  — on-read subscription order spawn + weekly prepaid billing
 */
export { loadDeliveryConfig } from './config';
export {
  buildMemberOrderView,
  buildPartnerOrderView,
  computeOrderFinancials,
  type PricedLine,
} from './orders';
export { advanceOrderStatus, type AdvanceOrderParams, type AdvanceOrderResult } from './advance';
export { materializeDueOrders, type MaterializeScope } from './materialize';
