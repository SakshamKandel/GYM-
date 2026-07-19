/**
 * Meal-order domain logic — the 7-state fulfillment machine (who may set what),
 * the subscription + weekly-billing-cycle machines, and the on-read
 * materialization planner. Pure logic, no I/O (CLAUDE.md rule 10; plan §3/§8).
 *
 * The route layer owns the extra guards this file deliberately does NOT encode
 * (paymentStatus for pending→confirmed, `now < cutoffAt` for member cancels):
 * those depend on live row/config state. Here we answer only the structural
 * question ("is this transition legal, and may this actor perform it?").
 */

import {
  cutoffFor,
  DEFAULT_CUTOFF_HOURS,
  ktmAddDays,
  ktmDayOfWeek,
  type CutoffHours,
  type MealCurrency,
  type MealWindow,
} from './meals';

// --- Order status machine ----------------------------------------------------

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'refused';

/** Who is attempting a transition (auth identity resolved by the route). */
export type OrderActor = 'member' | 'partner' | 'admin';

/** Frozen payment state carried by every meal order. */
export type OrderPaymentStatus = 'unpaid' | 'receipt_submitted' | 'paid' | 'refunded';

/** Decision state of a manual eSewa/Khalti receipt. */
export type MealPaymentRequestStatus = 'pending' | 'approved' | 'rejected' | 'refunded';

/**
 * Stable API error codes for a fulfillment mutation that would orphan money.
 *
 * - `payment_review_required`: a receipt is still pending; support must reject
 *   it before fulfilment can be cancelled.
 * - `refund_required`: money was approved/captured; the admin refund workflow
 *   must reverse it and cancel fulfilment together.
 */
export type PaymentMutationBlock = 'payment_review_required' | 'refund_required';

/**
 * May an ordinary cancel/skip/refuse mutate this order without a money-side
 * action? Refunded orders are safe because the dedicated refund workflow has
 * already reversed their payment; unpaid/COD orders have no captured money.
 */
export function orderPaymentMutationBlock(
  paymentStatus: OrderPaymentStatus,
): PaymentMutationBlock | null {
  switch (paymentStatus) {
    case 'receipt_submitted':
      return 'payment_review_required';
    case 'paid':
      return 'refund_required';
    case 'unpaid':
    case 'refunded':
      return null;
  }
}

/**
 * Resolve the money-side block for a prepaid subscription billing cycle.
 * Approved receipts take precedence over pending ones because real money has
 * already moved even if a prior partial write left the cycle short of `paid`.
 */
export function cyclePaymentMutationBlock(
  cycleStatus: CycleStatus,
  requestStatuses: readonly MealPaymentRequestStatus[] = [],
): PaymentMutationBlock | null {
  if (cycleStatus === 'paid' || requestStatuses.includes('approved')) {
    return 'refund_required';
  }
  // A submitted-but-unreviewed cycle receipt is money-in-review: block ordinary
  // mutations until staff decide it (mirrors an order's receipt_submitted).
  if (cycleStatus === 'receipt_submitted' || requestStatuses.includes('pending')) {
    return 'payment_review_required';
  }
  return null;
}

/** Pick the stricter result when several future orders/cycles are affected. */
export function mergePaymentMutationBlocks(
  blocks: readonly (PaymentMutationBlock | null)[],
): PaymentMutationBlock | null {
  if (blocks.includes('refund_required')) return 'refund_required';
  if (blocks.includes('payment_review_required')) return 'payment_review_required';
  return null;
}

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refused',
];

/** Terminal states — no outbound transitions. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'delivered',
  'cancelled',
  'refused',
];

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/**
 * Structural transition table (§8, actor-agnostic). This is the normal
 * fulfillment machine; the admin "cancel any non-terminal" override is layered
 * separately in {@link canActorAdvance} (out_for_delivery→cancelled is NOT part
 * of the normal machine but IS an admin override).
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'refused'],
  delivered: [],
  cancelled: [],
  refused: [],
};

/** Is `from → to` a legal transition of the normal fulfillment machine? */
export function canAdvance(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Which actors may perform each transition (plan §3 "Who" column, plus the
 * admin override rows). Keyed `"from>to"`. Any (non-terminal from → cancelled)
 * not listed here is still reachable by admin via the override in
 * {@link canActorAdvance}.
 */
const ORDER_ACTOR_MATRIX: Record<string, readonly OrderActor[]> = {
  'pending>confirmed': ['partner', 'admin'],
  'pending>cancelled': ['member', 'partner', 'admin'],
  'confirmed>preparing': ['partner', 'admin'],
  'confirmed>cancelled': ['partner', 'admin'],
  'preparing>out_for_delivery': ['partner', 'admin'],
  'preparing>cancelled': ['admin'],
  'out_for_delivery>delivered': ['partner', 'admin'],
  'out_for_delivery>refused': ['partner', 'admin'],
};

/** The actors explicitly permitted for a legal transition (empty if illegal). */
export function actorsFor(from: OrderStatus, to: OrderStatus): readonly OrderActor[] {
  return ORDER_ACTOR_MATRIX[`${from}>${to}`] ?? [];
}

/**
 * May `actor` move an order `from → to`? Encodes both the normal machine's
 * per-transition actor list AND the admin override: an admin may cancel ANY
 * non-terminal order (covers out_for_delivery→cancelled, which the normal
 * machine excludes). Route-level guards (payment/cutoff) apply on top.
 */
export function canActorAdvance(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  const allowed = ORDER_ACTOR_MATRIX[`${from}>${to}`];
  if (allowed) return allowed.includes(actor);
  // Admin override: cancel any non-terminal order, even one already out for
  // delivery (§3 "any non-terminal | cancelled | admin | override").
  if (actor === 'admin' && to === 'cancelled' && !isTerminalOrderStatus(from)) return true;
  return false;
}

// --- Member cancelability (payment-aware) ------------------------------------

/** Why a member's cancel is blocked (drives the pre-flight copy + support link). */
export type MemberCancelBlock = 'past_cutoff' | PaymentMutationBlock;

/** The minimal order shape {@link memberCancelability} needs. */
export interface MemberCancelableOrder {
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  cutoffAt: Date;
}

/**
 * The single source of truth WP-6 uses to gate the member cancel button (B1).
 * The structural machine only lets a member cancel a `pending` order; on top of
 * that this is payment-AWARE — a receipt-in-review or captured payment blocks the
 * plain cancel (the server would 409), so the button hides and the screen shows
 * the reason + a support/refund path instead of a guaranteed dead-end tap.
 *
 * Precedence: money-in-flight first (needs support/refund regardless of cutoff),
 * then cutoff. A non-member-cancelable status returns `{allowed:false}` with no
 * `blocked` reason (the affordance simply does not apply).
 */
export function memberCancelability(
  order: MemberCancelableOrder,
  now: Date,
): { allowed: boolean; blocked?: MemberCancelBlock } {
  if (!canActorAdvance(order.status, 'cancelled', 'member')) {
    return { allowed: false };
  }
  const paymentBlock = orderPaymentMutationBlock(order.paymentStatus);
  if (paymentBlock) return { allowed: false, blocked: paymentBlock };
  if (now.getTime() >= order.cutoffAt.getTime()) {
    return { allowed: false, blocked: 'past_cutoff' };
  }
  return { allowed: true };
}

// --- Partner refuse (any pre-delivery stage) ---------------------------------

/**
 * The statuses from which a partner may REFUSE/reject an order (B6/B7) — every
 * pre-delivery stage, wider than the normal cancel matrix. WP-7's advance route
 * gates the refuse action on this and persists the reason + member notify.
 */
export const partnerRefusableFrom: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
]);

/** May a partner refuse an order currently in `from`? */
export function partnerCanRefuse(from: OrderStatus): boolean {
  return partnerRefusableFrom.has(from);
}

/**
 * The terminal status a partner refusal lands on: an at-the-door refusal of an
 * out_for_delivery order → `refused`; refusing/rejecting any earlier stage →
 * `cancelled`. Returns null if the stage is not refusable.
 */
export function partnerRefuseTarget(from: OrderStatus): OrderStatus | null {
  if (!partnerCanRefuse(from)) return null;
  return from === 'out_for_delivery' ? 'refused' : 'cancelled';
}

// --- Human-readable order number ---------------------------------------------

/** Crockford base32 alphabet (no I/L/O/U — unambiguous for reading aloud). */
const ORDER_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A short, human-readable order code derived deterministically from the order id
 * (a UUID). Used on the confirmation screen, receipt, and tracking so a member
 * (and support) can reference an order without the raw UUID. Not a key — the id
 * remains authoritative; this is display only. Stable for a given id.
 */
export function orderNumber(id: string): string {
  const hex = id.replace(/[^0-9a-fA-F]/g, '');
  // Trailing 40 bits → exactly 8 base32 chars (32^8 === 2^40).
  let n = BigInt(`0x${hex.slice(-10) || '0'}`);
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code = ORDER_CODE_ALPHABET[Number(n % 32n)] + code;
    n /= 32n;
  }
  return `GM-${code}`;
}

// --- Subscription machine ----------------------------------------------------

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  active: ['paused', 'cancelled'],
  paused: ['active', 'cancelled'],
  cancelled: [],
};

export function canAdvanceSubscription(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Map a member subscription action to its target status (null = illegal). */
export function subscriptionActionTarget(
  action: 'pause' | 'resume' | 'cancel',
): SubscriptionStatus {
  switch (action) {
    case 'pause':
      return 'paused';
    case 'resume':
      return 'active';
    case 'cancel':
      return 'cancelled';
  }
}

// --- Billing cycle machine ---------------------------------------------------

export type CycleStatus =
  | 'open'
  | 'awaiting_payment'
  | 'receipt_submitted'
  | 'paid'
  | 'void';

export const CYCLE_TRANSITIONS: Record<CycleStatus, readonly CycleStatus[]> = {
  open: ['awaiting_payment', 'void'],
  // A member may submit a receipt (→receipt_submitted) or an admin may mark paid
  // directly; either may still be voided.
  awaiting_payment: ['receipt_submitted', 'paid', 'void'],
  // Staff review: approve→paid, reject→back to awaiting_payment, or void.
  receipt_submitted: ['awaiting_payment', 'paid', 'void'],
  paid: [],
  void: [],
};

export function canAdvanceCycle(from: CycleStatus, to: CycleStatus): boolean {
  return CYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface SkipRepricedCycle {
  status: CycleStatus;
  plannedSlots: number;
  pricePerDayMinor: number;
  amountMinor: number;
}

/**
 * Reprice an unfunded weekly cycle after a newly-created skip. Duplicate skips
 * and non-editable cycles are exact no-ops. A final removed slot voids the
 * cycle so it can never accept a zero-value receipt.
 */
export function repriceCycleForNewSkip(
  cycle: SkipRepricedCycle,
  isNewSkip: boolean,
): SkipRepricedCycle {
  if (!isNewSkip || (cycle.status !== 'open' && cycle.status !== 'awaiting_payment')) {
    return { ...cycle };
  }

  const plannedSlots = Math.max(0, Math.trunc(cycle.plannedSlots) - 1);
  const pricePerDayMinor = Math.max(0, Math.trunc(cycle.pricePerDayMinor));
  return {
    status: plannedSlots === 0 ? 'void' : cycle.status,
    plannedSlots,
    pricePerDayMinor,
    amountMinor: plannedSlots * pricePerDayMinor,
  };
}

// --- Partner rotation (deterministic) ----------------------------------------

/** Minimal shape needed to resolve a rotating-plan meal for a date/window. */
export interface RotationMeal {
  id: string;
}

/** Days since the Unix epoch for a KTM calendar date (deterministic index seed). */
function epochDayIndex(dateStr: string): number {
  const [y, mo, da] = dateStr.split('-').map((p) => Number(p));
  return Math.floor(Date.UTC(y, mo - 1, da) / 86_400_000);
}

/**
 * Deterministically pick the rotating-plan meal for `(date, window)`. Because it
 * depends only on the date, window, and the ordered rotation list, two racing
 * materializers resolve the SAME meal → the order-row conflict is a true no-op
 * (§8b). Throws on an empty rotation (callers must guard).
 */
export function partnerRotationFor(
  rotation: readonly RotationMeal[],
  date: string,
  window: MealWindow,
): string {
  if (rotation.length === 0) {
    throw new Error('partnerRotationFor: empty rotation');
  }
  const seed = epochDayIndex(date) * 2 + (window === 'dinner' ? 1 : 0);
  const idx = ((seed % rotation.length) + rotation.length) % rotation.length;
  return rotation[idx].id;
}

// --- Materialization planner -------------------------------------------------

/** A subscription as the planner needs to see it (route hydrates from the DB). */
export interface MaterializationSub {
  id: string;
  partnerId: string;
  accountId: string;
  daysOfWeek: readonly number[];
  window: MealWindow;
  planType: 'fixed_meal' | 'partner_rotating';
  mealId: string | null;
  addressId: string;
  pricePerDayMinor: number;
  currency: MealCurrency;
  startDate: string; // YYYY-MM-DD (KTM)
  status: SubscriptionStatus;
  /** Delivery dates the member has skipped. */
  skipDates: readonly string[];
  /** Ordered rotation meals — required (non-empty) for partner_rotating plans. */
  rotationMeals?: readonly RotationMeal[];
}

/** A single order the engine should upsert (CAS onConflictDoNothing). */
export interface PlannedOrder {
  subscriptionId: string;
  partnerId: string;
  accountId: string;
  deliveryDate: string;
  window: MealWindow;
  mealId: string;
  addressId: string;
  pricePerDayMinor: number;
  currency: MealCurrency;
  cutoffAt: Date;
}

/**
 * Compute the orders to materialize across a two-day KTM horizon (today +
 * tomorrow). For each ACTIVE subscription × horizon day, a slot is planned
 * only when: the day is on/after startDate, the weekday is subscribed, it is
 * not skipped, and `now` is still before the slot cutoff. Horizon-bounded so the
 * past never retro-spawns (§8e). Deterministic given (subs, horizon, now).
 */
export function buildMaterializationPlan(
  subs: readonly MaterializationSub[],
  horizon: { today: string; tomorrow: string },
  now: Date,
  hours: CutoffHours = DEFAULT_CUTOFF_HOURS,
): PlannedOrder[] {
  const plan: PlannedOrder[] = [];
  const days = [horizon.today, horizon.tomorrow];
  for (const sub of subs) {
    if (sub.status !== 'active') continue;
    for (const date of days) {
      if (date < sub.startDate) continue;
      if (!sub.daysOfWeek.includes(ktmDayOfWeek(date))) continue;
      if (sub.skipDates.includes(date)) continue;
      const cutoff = cutoffFor(date, sub.window, 'Asia/Kathmandu', hours);
      if (now.getTime() >= cutoff.getTime()) continue;

      let mealId: string | null;
      if (sub.planType === 'fixed_meal') {
        mealId = sub.mealId;
      } else {
        const rotation = sub.rotationMeals ?? [];
        if (rotation.length === 0) continue;
        mealId = partnerRotationFor(rotation, date, sub.window);
      }
      if (!mealId) continue;

      plan.push({
        subscriptionId: sub.id,
        partnerId: sub.partnerId,
        accountId: sub.accountId,
        deliveryDate: date,
        window: sub.window,
        mealId,
        addressId: sub.addressId,
        pricePerDayMinor: sub.pricePerDayMinor,
        currency: sub.currency,
        cutoffAt: cutoff,
      });
    }
  }
  return plan;
}

// --- Weekly billing helpers --------------------------------------------------

/**
 * The Sun–Sat KTM week bounds containing `dateStr` (getUTCDay: 0=Sun). Used to
 * upsert `meal_billing_cycles` (unique on subscriptionId+weekStart).
 */
export function weekBoundsFor(dateStr: string): { weekStart: string; weekEnd: string } {
  const dow = ktmDayOfWeek(dateStr); // 0=Sun … 6=Sat
  const weekStart = ktmAddDays(dateStr, -dow);
  const weekEnd = ktmAddDays(weekStart, 6);
  return { weekStart, weekEnd };
}
