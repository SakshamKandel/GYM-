/**
 * Meal-delivery engine runtime (§3 / P3). Cutoff + fee + status-machine PURE
 * logic lives in @gym/shared; this module is the DB-bound engine consumed by the
 * member routes here and by the partner (P5) and admin (P6) routes:
 *
 *  - config       — server-authoritative fee/cutoff singleton loader
 *  - orders       — fee computation + member/partner order serialization
 *  - advance      — the one race-safe CAS status-advance path (+ event + push)
 *  - materialize  — on-read subscription order spawn + weekly prepaid billing
 *  - orderEvents  — append-only audit rows for bulk (non-CAS) status changes
 *  - soldOut      — per-slot sold-out lookup for the checkout pre-flight
 */
export { loadDeliveryConfig } from './config';
export {
  buildMemberOrderView,
  buildOrderReceipt,
  buildPartnerOrderView,
  computeOrderFinancials,
  type PricedLine,
} from './orders';
export { advanceOrderStatus, type AdvanceOrderParams, type AdvanceOrderResult } from './advance';
export {
  autoPauseIfOverdue,
  materializeDueOrders,
  staleAwaitingCycles,
  type MaterializeOptions,
  type MaterializeScope,
  type StaleCycle,
} from './materialize';
export { subscriptionPaymentMutationBlock } from './paymentSafety';
export {
  atomicCycleReceiptSql,
  atomicSubscriptionSkipSql,
  mealCycleOperationLockSql,
  type AtomicSubscriptionSkipOutcome,
} from './skipRepricing';
export {
  atomicSubscriptionCreateSql,
  atomicSubscriptionEditSql,
  type AtomicSubscriptionEditOutcome,
} from './subscriptionEdit';
export {
  guardedMealPatchSql,
  guardedMealSoftDeleteSql,
  type MealPatchFields,
} from './menuSubscriptionSafety';
export {
  guardedOrderItemInsertSql,
  mealOrderItemsLockSql,
  type GuardedOrderItemInsertArgs,
} from './orderItemsSql';
export { appendBulkOrderEvents, type BulkOrderTransition } from './orderEvents';
export { soldOutMealIdsForSlot } from './soldOut';
// Exported for any other raw-SQL builder: a bare array param renders as a ROW
// constructor in drizzle's `sql` template, never as a Postgres array.
export { pgIntArray, pgTextArray } from './pgArray';
export {
  buildCycleInvoice,
  buildSubscriptionCycleAdjustments,
  prorateUnusedPaidDays,
  quoteSubscriptionPlan,
  upcomingDeliveryDates,
  type CycleInvoice,
  type SubscriptionPlanShape,
} from './subscriptionPlan';
