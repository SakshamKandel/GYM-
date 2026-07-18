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

export type CycleStatus = 'open' | 'awaiting_payment' | 'paid' | 'void';

export const CYCLE_TRANSITIONS: Record<CycleStatus, readonly CycleStatus[]> = {
  open: ['awaiting_payment', 'void'],
  awaiting_payment: ['paid', 'void'],
  paid: [],
  void: [],
};

export function canAdvanceCycle(from: CycleStatus, to: CycleStatus): boolean {
  return CYCLE_TRANSITIONS[from]?.includes(to) ?? false;
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
