import {
  canActorAdvance,
  isSlotOrderable,
  ktmAddDays,
  ktmDateString,
  MEAL_WINDOW_TIMES,
  type MealWindow,
} from '@gym/shared';
import type { MealDietType, MealGoalTag, MealOrder, MealOrderStatus, MealPaymentMethod } from './api';

/**
 * Pure display + eligibility helpers for the meals feature. Everything that
 * touches money/cutoff authority still lives server-side (invariant §8a) —
 * this file only mirrors the SAME pure @gym/shared logic the server uses so
 * the UI can pre-validate and label things without a round trip; the server
 * re-checks everything on submit.
 */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_OPTIONS = [0, 1, 2, 3, 4, 5, 6];

export function weekdayLabel(dayOfWeek: number): string {
  return DAY_LABELS[dayOfWeek] ?? '?';
}

export function dietLabel(diet: MealDietType): string {
  switch (diet) {
    case 'veg':
      return 'Veg';
    case 'non_veg':
      return 'Non-veg';
    case 'egg':
      return 'Egg';
  }
}

export function goalLabel(goal: MealGoalTag): string {
  switch (goal) {
    case 'cutting':
      return 'Cutting';
    case 'bulking':
      return 'Bulking';
    case 'balanced':
      return 'Balanced';
  }
}

export function windowLabel(window: MealWindow): string {
  const times = MEAL_WINDOW_TIMES[window];
  return window === 'lunch' ? `Lunch (${times.start}–${times.end})` : `Dinner (${times.start}–${times.end})`;
}

export function paymentMethodLabel(method: MealPaymentMethod): string {
  switch (method) {
    case 'esewa':
      return 'eSewa';
    case 'khalti':
      return 'Khalti';
    case 'cod':
      return 'Cash on delivery';
  }
}

export function isDigitalMethod(method: MealPaymentMethod): method is 'esewa' | 'khalti' {
  return method === 'esewa' || method === 'khalti';
}

/** "P 32 · C 48 · F 12" macro line, same convention as the Food tab. */
export function macroLine(proteinG: number, carbsG: number, fatG: number): string {
  return `P ${Math.round(proteinG)} · C ${Math.round(carbsG)} · F ${Math.round(fatG)}`;
}

/** A short slot chip label: "Today · Lunch", "Tomorrow · Dinner", "Jul 22 · Lunch". */
export function slotLabel(deliveryDate: string, window: MealWindow, now: Date = new Date()): string {
  const today = ktmDateString(now);
  const tomorrow = ktmAddDays(today, 1);
  const day = deliveryDate === today ? 'Today' : deliveryDate === tomorrow ? 'Tomorrow' : deliveryDate;
  return `${day} · ${window === 'lunch' ? 'Lunch' : 'Dinner'}`;
}

/** The next few candidate delivery slots, in cutoff order, each flagged for
 * whether it's still orderable right now (client-side preview only — the
 * server is the final word via `isSlotOrderable` at submit time). */
export function upcomingSlots(
  now: Date = new Date(),
  count = 6,
): { date: string; window: MealWindow; orderable: boolean; label: string }[] {
  const out: { date: string; window: MealWindow; orderable: boolean; label: string }[] = [];
  let date = ktmDateString(now);
  for (let i = 0; i < 10 && out.length < count; i += 1) {
    for (const window of ['lunch', 'dinner'] as const) {
      if (out.length >= count) break;
      out.push({ date, window, orderable: isSlotOrderable(date, window, now), label: slotLabel(date, window, now) });
    }
    date = ktmAddDays(date, 1);
  }
  return out;
}

// ── Order status timeline ────────────────────────────────────────

export interface TimelineStep {
  key: MealOrderStatus;
  label: string;
  at: string | null;
}

const HAPPY_PATH: MealOrderStatus[] = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

const STATUS_LABEL: Record<MealOrderStatus, string> = {
  pending: 'Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refused: 'Refused',
};

export function orderStatusLabel(status: MealOrderStatus): string {
  return STATUS_LABEL[status];
}

/** Semantic tone token key for a status pill — screens map this to colors. */
export function orderStatusTone(status: MealOrderStatus): 'accent' | 'success' | 'error' | 'dim' {
  if (status === 'delivered') return 'success';
  if (status === 'cancelled' || status === 'refused') return 'error';
  if (status === 'pending') return 'dim';
  return 'accent';
}

/** Build the happy-path timeline for an order, cut short at a terminal
 * cancelled/refused state (those render as their own final row instead). */
export function orderTimeline(order: MealOrder): TimelineStep[] {
  const timestampFor = (status: MealOrderStatus): string | null => {
    switch (status) {
      case 'pending':
        return order.placedAt;
      case 'confirmed':
        return order.confirmedAt;
      case 'delivered':
        return order.deliveredAt;
      default:
        return null;
    }
  };
  const currentIdx = HAPPY_PATH.indexOf(order.status);
  const upTo = currentIdx === -1 ? HAPPY_PATH.length : currentIdx + 1;
  return HAPPY_PATH.slice(0, Math.max(upTo, 1)).map((key) => ({
    key,
    label: orderStatusLabel(key),
    at: timestampFor(key),
  }));
}

/** May the member cancel this order right now (structural + cutoff)? Mirrors
 * the server's rule for the UI's cancel affordance; the route re-checks it. */
export function canMemberCancelOrder(order: MealOrder, now: Date = new Date()): boolean {
  if (!canActorAdvance(order.status, 'cancelled', 'member')) return false;
  return now.getTime() < new Date(order.cutoffAt).getTime();
}

/** Does this order still need an eSewa/Khalti receipt submitted? */
export function orderNeedsReceipt(order: MealOrder): boolean {
  return isDigitalMethod(order.paymentMethod) && order.paymentStatus === 'unpaid';
}

export function paymentStatusLabel(order: MealOrder): string {
  switch (order.paymentStatus) {
    case 'unpaid':
      return order.paymentMethod === 'cod' ? 'Pay on delivery' : 'Payment needed';
    case 'receipt_submitted':
      return 'Receipt under review';
    case 'paid':
      return 'Paid';
    case 'refunded':
      return 'Refunded';
  }
}

/** Generic fallback-friendly message for a server error `code`. Codes this
 * feature doesn't specifically recognise still get a sensible default. */
export function mealErrorMessage(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again to continue.';
    case 'forbidden':
      return "You don't have permission to do that.";
    case 'past_cutoff':
      return 'That slot has already passed its ordering cutoff.';
    case 'out_of_range':
    case 'start_out_of_range':
      return 'Pick a date within the next 30 days.';
    case 'partner_unavailable':
      return 'This partner is no longer taking orders.';
    case 'cod_unavailable':
      return "This partner doesn't accept cash on delivery — pick eSewa or Khalti.";
    case 'address_not_found':
      return "That address couldn't be found — pick or add another.";
    case 'meal_unavailable':
    case 'meal_unavailable_for_slot':
    case 'meal_unavailable_for_window':
      return "That meal isn't available for the slot you picked.";
    case 'mixed_currency':
      return 'Items from different currencies can’t be combined in one order.';
    case 'meal_required':
      return 'Pick a meal for a fixed-meal plan.';
    case 'meal_not_allowed':
      return 'A rotating plan doesn’t take a fixed meal.';
    case 'no_meals':
    case 'no_meals_for_window':
      return 'This partner has no meals available for that window yet.';
    case 'not_cancellable':
    case 'invalid_transition':
    case 'conflict':
      return 'That action no longer applies — refresh and try again.';
    case 'idempotency_conflict':
      return 'This checkout changed while it was being submitted. Review it and try again.';
    case 'not_active':
      return 'This subscription is no longer active.';
    case 'past_date':
    case 'not_a_delivery_day':
      return "That date doesn't match this plan's delivery days.";
    case 'order_not_found':
    case 'cycle_not_found':
    case 'not_found':
      return "Couldn't find that — it may have changed.";
    case 'cod_no_receipt':
      return 'Cash-on-delivery orders don’t need a receipt.';
    case 'order_closed':
      return 'This order is already closed.';
    case 'already_paid':
      return 'This order is already marked paid.';
    case 'order_refunded':
      return 'This order was refunded.';
    case 'cycle_not_payable':
      return "This week's bill isn't ready for payment yet.";
    case 'already_pending':
      return 'A receipt is already awaiting review for this.';
    case 'receipt_already_used':
      return 'That receipt has already been submitted elsewhere.';
    case 'exactly_one_target':
      return 'Something went wrong preparing that payment — try again.';
    case 'invalid':
      return 'Check your details and try again.';
    default:
      return "Couldn't reach the server — check your connection and try again.";
  }
}
