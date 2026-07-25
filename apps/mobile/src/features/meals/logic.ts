import {
  canOpenDispute,
  DISPUTE_REASONS,
  formatMoney,
  isSlotOrderable,
  ktmAddDays,
  ktmDateString,
  MEAL_WINDOW_TIMES,
  memberCancelability,
  tipOptions,
  type DisputeReason,
  type MemberCancelBlock,
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

export interface UpcomingSlot {
  date: string;
  window: MealWindow;
  orderable: boolean;
  label: string;
}

/** The next few candidate delivery slots, in cutoff order, each flagged for
 * whether it's still orderable right now (client-side preview only — the
 * server is the final word via `isSlotOrderable` at submit time).
 *
 * Cutoff caveat (2026-07-25): `isSlotOrderable` is called WITHOUT a
 * `CutoffHours` argument, so this preview uses the frozen 21:00/10:00 defaults
 * while the server uses the admin-editable `meal_delivery_config` hours. No
 * member-facing route exposes those hours yet, so the client cannot mirror
 * them. The disagreement is handled rather than guessed: a slot the server
 * refuses as `past_cutoff` is remembered via {@link slotKey} and taken out of
 * the picker (see /meals/checkout), so the member is corrected once by the
 * authority instead of being told a wrong story twice. */
export function upcomingSlots(now: Date = new Date(), count = 6): UpcomingSlot[] {
  const out: UpcomingSlot[] = [];
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

/** Stable identity for one delivery slot (date + window). */
export function slotKey(date: string, window: MealWindow): string {
  return `${date}|${window}`;
}

/**
 * Index of the first slot a member can actually order — the checkout's default
 * selection. The list starts at TODAY's lunch, which is past its cutoff for
 * most of the day, so defaulting to index 0 lands the member on a dead slot.
 * `closedKeys` carries slots the server has since refused (see
 * {@link upcomingSlots}); `-1` means nothing in the list is orderable.
 */
export function firstOrderableSlotIndex(
  slots: readonly UpcomingSlot[],
  closedKeys: ReadonlySet<string> = new Set<string>(),
): number {
  return slots.findIndex((s) => s.orderable && !closedKeys.has(slotKey(s.date, s.window)));
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

/**
 * The single source of truth for the member cancel affordance (B1) — a thin
 * wrapper over `@gym/shared`'s `memberCancelability` (the exact rule the
 * server enforces) so the UI never shows a Cancel button the route will
 * always 409. Payment-in-flight (`payment_review_required`/`refund_required`)
 * takes precedence over cutoff — those need a support/refund path, not a
 * plain cancel.
 */
export function memberOrderCancelState(
  order: MealOrder,
  now: Date = new Date(),
): { allowed: boolean; blocked?: MemberCancelBlock } {
  return memberCancelability({ status: order.status, paymentStatus: order.paymentStatus, cutoffAt: new Date(order.cutoffAt) }, now);
}

/** May the member cancel this order right now? Convenience boolean over
 * {@link memberOrderCancelState} for call sites that don't need the reason. */
export function canMemberCancelOrder(order: MealOrder, now: Date = new Date()): boolean {
  return memberOrderCancelState(order, now).allowed;
}

/** Short banner copy for a blocked cancel (B1/B2) — precedes a "Contact
 * support" forward path rather than dead-ending the tap. `null` for
 * `past_cutoff` (that case just hides the button; no banner needed). */
export function cancelBlockMessage(blocked: MemberCancelBlock): string | null {
  switch (blocked) {
    case 'payment_review_required':
      return 'A payment receipt is under review. Contact support to cancel this order.';
    case 'refund_required':
      return 'This order is already paid. Contact support so the refund and cancellation happen together.';
    case 'past_cutoff':
      return null;
  }
}

/** Does this blocked reason need a "Contact support" forward path (B2/E)? */
export function cancelBlockNeedsSupport(blocked: MemberCancelBlock): boolean {
  return blocked === 'payment_review_required' || blocked === 'refund_required';
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
      return 'Your session expired. Sign in again to continue.';
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
      return "This partner doesn't accept cash on delivery. Pick eSewa or Khalti.";
    case 'address_not_found':
      return "That address couldn't be found. Pick or add another.";
    case 'outside_delivery_area':
      return "That address is outside this partner's delivery area; pick another.";
    case 'delivery_area_unverified':
      return "We couldn't verify delivery to that address; add a map pin or pick another.";
    case 'meal_unavailable':
    case 'meal_unavailable_for_slot':
    case 'meal_unavailable_for_window':
      return "That meal isn't available for the slot you picked.";
    case 'mixed_currency':
      return 'Items from different currencies can’t be combined in one order.';
    case 'meal_required':
      return 'Pick a meal for a fixed-meal plan.';
    case 'meal_not_allowed':
      return 'A rotating meal plan doesn’t take a fixed meal.';
    case 'no_meals':
    case 'no_meals_for_window':
      return 'This partner has no meals available for that window yet.';
    case 'not_cancellable':
    case 'invalid_transition':
    case 'conflict':
      return 'That action no longer applies. Refresh and try again.';
    case 'payment_review_required':
      return 'A payment receipt is under review. Contact support before cancelling or skipping.';
    case 'refund_required':
      return 'This has already been paid. Contact support so the refund and cancellation happen together.';
    case 'idempotency_conflict':
      return 'This checkout changed while it was being submitted. Review it and try again.';
    case 'not_active':
      return 'This meal plan is no longer active.';
    case 'past_date':
    case 'not_a_delivery_day':
      return "That date doesn't match this meal plan's delivery days.";
    case 'order_not_found':
    case 'cycle_not_found':
    case 'not_found':
      return "Couldn't find that. It may have changed.";
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
    case 'image_not_configured':
      return 'Receipt uploads are temporarily unavailable. Please contact support.';
    case 'exactly_one_target':
      return 'Something went wrong preparing that payment. Try again.';
    case 'invalid':
      return 'Check your details and try again.';
    case 'already_rated':
      return "You've already rated this order.";
    case 'not_delivered':
      return "This order hasn't been delivered yet. You can rate or tip it once it arrives.";
    case 'invalid_tip':
      return 'Enter a valid tip amount and try again.';
    case 'tip_locked':
      return "This order has already been paid, so the tip can't be changed.";
    case 'dispute_exists':
      return 'You already have an open report for this order. Check its status before filing another.';
    case 'not_disputable':
      return "This order isn't eligible for a dispute yet.";
    default:
      return "That didn't go through. Check your connection and try again.";
  }
}

// ── Price-change interstitial (B9/B10/Pack F) ────────────────────────

/** "Price updated Rs 450→Rs 470, confirm?" copy for the checkout guard's
 * 409 `price_changed` response. */
export function priceChangeMessage(quotedMinor: number, currentMinor: number, currency: string): string {
  return `Price updated ${formatMoney(quotedMinor, currency)} → ${formatMoney(currentMinor, currency)}. Confirm to place at the new total.`;
}

/** Per-line "X unavailable — remove & continue" copy (B11) for a quote's 422
 * `meal_unavailable` response, naming the specific meal when the server sent
 * a name (it may not for a wholly unknown id). */
export function mealUnavailableLineMessage(mealName: string | null | undefined): string {
  return mealName
    ? `${mealName} isn't available for this slot anymore. Remove it and continue.`
    : "One of these meals isn't available for this slot anymore. Remove it and continue.";
}

// ── Tips (Pack D) ─────────────────────────────────────────────────────

export { tipOptions };

/** "10%" / "No tip" preset button label. */
export function tipPresetLabel(percent: number): string {
  return percent === 0 ? 'No tip' : `${percent}%`;
}

// ── Disputes / report-a-problem (Pack E) ─────────────────────────────

export { DISPUTE_REASONS };
export type { DisputeReason };

/**
 * May the member report a problem with this order? A thin wrapper over
 * `@gym/shared`'s `canOpenDispute` — the EXACT predicate the dispute route
 * enforces — so the button and the server agree. Delivered orders qualify, and
 * so does any order whose money was captured: a prepaid order that was then
 * refused or cancelled is precisely the case that needs a refund path, and
 * gating the button on `delivered` alone hid it from those members.
 */
export function canReportOrderProblem(order: MealOrder): boolean {
  return canOpenDispute(order.status, order.paymentStatus);
}

// ── Weekly plan pricing (member-facing preview) ───────────────────────

/** What a full week of a weekly plan costs: the server-quoted per-day price
 * (meal + delivery) times the number of delivery days chosen. Mirrors how a
 * billing cycle is charged (planned slots × price per day). */
export function weeklyPlanTotalMinor(pricePerDayMinor: number, deliveryDays: number): number {
  return Math.max(0, Math.trunc(pricePerDayMinor)) * Math.max(0, Math.trunc(deliveryDays));
}

export function disputeReasonLabel(reason: DisputeReason): string {
  switch (reason) {
    case 'not_delivered':
      return 'Never arrived';
    case 'wrong_items':
      return 'Wrong items';
    case 'quality':
      return 'Quality issue';
    case 'late':
      return 'Arrived very late';
    case 'other':
      return 'Something else';
  }
}
