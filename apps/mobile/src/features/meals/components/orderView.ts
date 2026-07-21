import { ktmAddDays, ktmDateString, MEAL_WINDOW_TIMES, type MealWindow } from '@gym/shared';
import { colors } from '@gym/ui-tokens';
import type { MealOrder, MealOrderStatus } from '../api';
import { orderStatusLabel } from '../logic';

/**
 * Presentation-only helpers for the member "my orders" screen redesign
 * (features/meals/components/*). Pure, side-effect-free, and co-located with
 * the cards/sheet that consume them — the same split the rest of the meals
 * feature keeps between `logic.ts` (shared eligibility mirrors) and per-surface
 * view helpers. Nothing here touches money/cutoff authority; the server row is
 * always the source of truth.
 */

// ── Macro roll-up (this is a fitness app: protein + kcal lead) ──────

export interface OrderMacroTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Sum every item's macro snapshot × its quantity across the whole order. */
export function sumOrderMacros(order: MealOrder): OrderMacroTotals {
  return order.items.reduce<OrderMacroTotals>(
    (acc, item) => ({
      kcal: acc.kcal + item.macros.kcal * item.qty,
      proteinG: acc.proteinG + item.macros.proteinG * item.qty,
      carbsG: acc.carbsG + item.macros.carbsG * item.qty,
      fatG: acc.fatG + item.macros.fatG * item.qty,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

/** Total number of physical meals in the order (sum of quantities). */
export function orderItemCount(order: MealOrder): number {
  return order.items.reduce((sum, item) => sum + item.qty, 0);
}

/** "2× Grilled Chicken · Paneer Bowl" — a one-line summary of what's coming. */
export function orderItemsSummary(order: MealOrder): string {
  if (order.items.length === 0) return 'No items';
  return order.items
    .map((item) => (item.qty > 1 ? `${item.qty}× ${item.name}` : item.name))
    .join(' · ');
}

// ── Slot / window display ──────────────────────────────────────────

function twelveHour(hhmm: string): { hour: number; period: 'AM' | 'PM' } {
  const [h] = hhmm.split(':').map((p) => Number(p));
  const period: 'AM' | 'PM' = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return { hour, period };
}

/** The delivery time band as a compact chip label: lunch → "11 AM–1 PM",
 * dinner → "6–8 PM" (the shared AM/PM suffix is collapsed when it matches). */
export function windowTimeRange(window: MealWindow): string {
  const { start, end } = MEAL_WINDOW_TIMES[window];
  const s = twelveHour(start);
  const e = twelveHour(end);
  return s.period === e.period
    ? `${s.hour}–${e.hour} ${e.period}`
    : `${s.hour} ${s.period}–${e.hour} ${e.period}`;
}

export function windowName(window: MealWindow): string {
  return window === 'lunch' ? 'Lunch' : 'Dinner';
}

/** "Today" / "Tomorrow" for a delivery date, else null (caller formats the date). */
export function relativeDay(deliveryDate: string, now: Date = new Date()): 'Today' | 'Tomorrow' | null {
  const today = ktmDateString(now);
  if (deliveryDate === today) return 'Today';
  if (deliveryDate === ktmAddDays(today, 1)) return 'Tomorrow';
  return null;
}

/** Section-header label for grouping history: Today / Yesterday / "Jul 17". */
export function dayGroupLabel(deliveryDate: string, now: Date = new Date()): string {
  const today = ktmDateString(now);
  if (deliveryDate === today) return 'Today';
  if (deliveryDate === ktmAddDays(today, -1)) return 'Yesterday';
  return formatCalendarDate(deliveryDate);
}

/** A `YYYY-MM-DD` KTM date → "Jul 17" (UTC-parsed so no tz drift). */
export function formatCalendarDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map((p) => Number(p));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateStr;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** An ISO instant → "Jul 18 · 9:30 AM" for the event timeline. */
export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

// ── Fee breakdown ──────────────────────────────────────────────────

export interface FeeRow {
  label: string;
  amountMinor: number;
  /** Emphasized total row. */
  total?: boolean;
}

/** The fee ladder shown in the detail sheet — only non-zero fees appear. */
export function orderFeeRows(order: MealOrder): FeeRow[] {
  const rows: FeeRow[] = [{ label: 'Subtotal', amountMinor: order.subtotalMinor }];
  if (order.deliveryFeeMinor > 0) rows.push({ label: 'Delivery', amountMinor: order.deliveryFeeMinor });
  if (order.smallOrderFeeMinor > 0) rows.push({ label: 'Small-order fee', amountMinor: order.smallOrderFeeMinor });
  rows.push({ label: 'Total', amountMinor: order.totalMinor, total: true });
  return rows;
}

// ── Status stepper + event timeline ────────────────────────────────

export const HAPPY_PATH: MealOrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
];

// ── Status color language (2026-07-21 professional pass) ───────────
// One semantic color per live status so a member reads order state at a
// glance: amber = waiting on the kitchen, blue = locked in, orange = on the
// stove, red = rider moving (brand accent = action), green = done, and the
// error red for the two terminal stops. Washes are the matching ~18% tints
// from @gym/ui-tokens (contrast-checked there for text-on-wash use).

const STATUS_COLOR: Record<MealOrderStatus, string> = {
  pending: colors.warning,
  confirmed: colors.info,
  preparing: colors.orange,
  out_for_delivery: colors.accent,
  delivered: colors.success,
  cancelled: colors.error,
  refused: colors.error,
};

const STATUS_WASH: Record<MealOrderStatus, string> = {
  pending: colors.warningFaint,
  confirmed: colors.infoFaint,
  preparing: colors.orangeFaint,
  out_for_delivery: colors.accentFaint,
  delivered: colors.successFaint,
  cancelled: colors.accentFaint,
  refused: colors.accentFaint,
};

/** Semantic foreground color for an order status (icons, pills, dots). */
export function orderStatusColor(status: MealOrderStatus): string {
  return STATUS_COLOR[status];
}

/** Matching tinted fill to sit behind {@link orderStatusColor} text/icons. */
export function orderStatusWash(status: MealOrderStatus): string {
  return STATUS_WASH[status];
}

/** Short stepper labels (the full "Out for delivery" is too wide under a dot). */
const STEP_SHORT: Record<MealOrderStatus, string> = {
  pending: 'Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refused: 'Refused',
};

export function stepShortLabel(status: MealOrderStatus): string {
  return STEP_SHORT[status];
}

export interface StepperModel {
  steps: { key: MealOrderStatus; label: string; done: boolean; current: boolean }[];
  /** Index of the current step (0-based), or steps.length-1 when delivered. */
  currentIndex: number;
  terminal: boolean;
}

/** Build the 5-step happy-path stepper model for a non-terminal (or delivered)
 * order. Cancelled/refused orders are handled by the card's muted branch and
 * never reach here. */
export function buildStepper(status: MealOrderStatus): StepperModel {
  const currentIndex = Math.max(0, HAPPY_PATH.indexOf(status));
  const steps = HAPPY_PATH.map((key, i) => ({
    key,
    label: STEP_SHORT[key],
    done: i < currentIndex || status === 'delivered',
    current: i === currentIndex && status !== 'delivered',
  }));
  return { steps, currentIndex, terminal: status === 'delivered' };
}

export interface EventRow {
  key: string;
  label: string;
  at: string | null;
  reached: boolean;
  tone: 'accent' | 'success' | 'error' | 'dim';
}

/** The vertical event timeline for the detail sheet, built from the order's
 * own frozen timestamps (there is no member-facing meal_order_events read
 * route — the engine only exposes order rows). Preparing / out-for-delivery
 * carry no timestamp column, so they show as reached-but-untimed steps. */
export function orderEventRows(order: MealOrder): EventRow[] {
  if (order.status === 'cancelled' || order.status === 'refused') {
    return [
      { key: 'pending', label: orderStatusLabel('pending'), at: order.placedAt, reached: true, tone: 'accent' },
      {
        key: order.status,
        label: order.status === 'refused' ? 'Delivery refused' : 'Cancelled',
        at: order.cancelledAt,
        reached: true,
        tone: 'error',
      },
    ];
  }

  const currentIndex = Math.max(0, HAPPY_PATH.indexOf(order.status));
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
  return HAPPY_PATH.map((key, i) => {
    const reached = i <= currentIndex || order.status === 'delivered';
    return {
      key,
      label: orderStatusLabel(key),
      at: timestampFor(key),
      reached,
      tone: key === 'delivered' && reached ? ('success' as const) : reached ? ('accent' as const) : ('dim' as const),
    };
  });
}
