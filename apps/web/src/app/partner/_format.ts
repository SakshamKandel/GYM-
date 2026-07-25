import {
  MEAL_WINDOW_TIMES,
  TERMINAL_ORDER_STATUSES,
  type DisputeReason,
  type DisputeStatus,
  type MealWindow,
  type OrderStatus,
} from '@gym/shared';
import type { PartnerOrderView } from './_data';

/**
 * Pure display helpers shared by the partner portal's server pages and client
 * components (no 'server-only' marker, unlike _data.ts). Money is minor units
 * (paisa/cents); dates are KTM `YYYY-MM-DD` strings rendered without pulling in a
 * timezone dependency.
 */

/** `25000, 'NPR'` → `Rs 250` · `250, 'USD'` → `$2.50`. */
export function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return currency === 'NPR' ? `Rs ${major.toFixed(0)}` : `$${major.toFixed(2)}`;
}

/** `'lunch'` → `Lunch · 11:00–13:00`. */
export function windowLabel(window: MealWindow): string {
  const t = MEAL_WINDOW_TIMES[window];
  const name = window === 'lunch' ? 'Lunch' : 'Dinner';
  return `${name} · ${t.start}–${t.end}`;
}

/** Short window tag for compact rows. */
export function windowShort(window: MealWindow): string {
  return window === 'lunch' ? 'Lunch' : 'Dinner';
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refused: 'Refused',
};

export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'critical' | 'info';

export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: 'warning',
  confirmed: 'info',
  preparing: 'info',
  out_for_delivery: 'info',
  delivered: 'positive',
  cancelled: 'critical',
  refused: 'critical',
};

/**
 * Semantic status colors (CSS custom properties from globals.css) for the ops
 * board's strips/dots — the board reads state from across the room, so each
 * stage carries its own color: amber waits on the kitchen, blue is in the
 * kitchen, orange marks the rider moving, green is done, red is terminal.
 */
export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  pending: 'var(--gt-warning)',
  confirmed: 'var(--gt-info)',
  preparing: 'var(--gt-info)',
  out_for_delivery: 'var(--gt-accent)',
  delivered: 'var(--gt-success)',
  cancelled: 'var(--gt-danger)',
  refused: 'var(--gt-danger)',
};

/**
 * Reported-problem vocabulary, in the words a restaurant would use. The stored
 * values are machine keys; a kitchen should never be shown `not_delivered`.
 */
export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  not_delivered: 'Never arrived',
  wrong_items: 'Wrong items',
  quality: 'Food quality',
  late: 'Arrived late',
  other: 'Something else',
};

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'With the team',
  reviewing: 'Being reviewed',
  resolved: 'Resolved',
  rejected: 'Closed, no action',
};

export const DISPUTE_STATUS_TONE: Record<DisputeStatus, BadgeTone> = {
  open: 'critical',
  reviewing: 'warning',
  resolved: 'positive',
  rejected: 'neutral',
};

/** `4` → `★★★★☆`. Decorative only; always pair it with the number for readers. */
export function starRow(stars: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(stars)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `'2026-07-20'` → `Mon, Jul 20`. Interprets the string as a plain KTM date. */
export function formatDateLabel(dateStr: string): string {
  const [y, mo, da] = dateStr.split('-').map((p) => Number(p));
  if (!y || !mo || !da) return dateStr;
  const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
  return `${DOW[dow]}, ${MONTHS[mo - 1]} ${da}`;
}

export const DIET_LABEL: Record<string, string> = {
  veg: 'Veg',
  non_veg: 'Non-veg',
  egg: 'Egg',
};

export const PAYMENT_LABEL: Record<string, string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  cod: 'Cash on delivery',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  receipt_submitted: 'Receipt submitted',
  paid: 'Paid',
  refunded: 'Refunded',
};

// Nepal is a fixed UTC+5:45 offset (no DST), so a KTM wall-clock instant is a
// pure arithmetic shift — no timezone library needed. Mirrors the offset the
// shared meal engine freezes cutoffs with.
const KTM_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/**
 * `2026-07-20T08:45:00Z` → `Jul 20, 2:30 PM`, always on the Kathmandu clock the
 * kitchen actually runs on. Deliberately NOT `Intl` with the viewer's timezone:
 * these stamps are server-rendered, so a browser-local formatter would print one
 * time on the server and another after hydration, and a restaurant in Kathmandu
 * would read a delivery time in someone else's afternoon.
 */
export function formatKtmDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms + KTM_OFFSET_MS);
  const hours24 = d.getUTCHours();
  const suffix = hours24 < 12 ? 'AM' : 'PM';
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = `${d.getUTCMinutes()}`.padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hour12}:${minutes} ${suffix}`;
}

/**
 * Epoch-ms of a delivery slot's WINDOW START (not its ordering cutoff) — e.g.
 * lunch on 2026-07-20 → 11:00 KTM that day. Used to flag orders whose delivery
 * window has already begun. Pure + client-safe (no Date-timezone dependence).
 */
export function windowStartMs(dateStr: string, window: MealWindow): number {
  const [y, mo, da] = dateStr.split('-').map((p) => Number(p));
  const [hh, mm] = MEAL_WINDOW_TIMES[window].start.split(':').map((p) => Number(p));
  if (!y || !mo || !da) return Number.NaN;
  return Date.UTC(y, mo - 1, da, hh, mm) - KTM_OFFSET_MS;
}

/**
 * An order is LATE when its delivery window has already started yet it is not in
 * a terminal state (delivered/cancelled/refused). Kitchen-critical highlight.
 */
export function isOrderLate(order: PartnerOrderView, nowMs: number): boolean {
  if (TERMINAL_ORDER_STATUSES.includes(order.status)) return false;
  const start = windowStartMs(order.deliveryDate, order.window);
  return Number.isFinite(start) && nowMs >= start;
}

/** `≤0 → "Window open"`, else a compact `2h 15m` / `18m` countdown. */
export function formatCountdown(msRemaining: number): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return 'Window open';
  const totalMin = Math.floor(msRemaining / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** One aggregated dish the kitchen must cook, across a window's live orders. */
export interface PrepLine {
  name: string;
  qty: number;
  orders: number;
}

/** Per-window prep rollup — what to cook for one delivery window today. */
export interface PrepWindowSummary {
  window: MealWindow;
  lines: PrepLine[];
  totalItems: number;
  totalOrders: number;
}

// Only orders that still need cooking count toward prep — once a meal is out for
// delivery or terminal the kitchen is done with it.
const PREP_COOK_STATUSES: readonly OrderStatus[] = ['pending', 'confirmed', 'preparing'];

/**
 * Aggregate a set of orders into a per-window `meal × qty` cook list (lunch then
 * dinner). Pure: the caller pre-filters to the delivery date it cares about.
 * Lines are sorted by descending quantity so the biggest cook jobs lead.
 */
export function buildPrepSummary(orders: readonly PartnerOrderView[]): PrepWindowSummary[] {
  const windows: MealWindow[] = ['lunch', 'dinner'];
  return windows.map((window) => {
    const relevant = orders.filter(
      (o) => o.window === window && PREP_COOK_STATUSES.includes(o.status),
    );
    const byMeal = new Map<string, PrepLine>();
    for (const order of relevant) {
      for (const item of order.items) {
        const line = byMeal.get(item.name) ?? { name: item.name, qty: 0, orders: 0 };
        line.qty += item.qty;
        line.orders += 1;
        byMeal.set(item.name, line);
      }
    }
    const lines = [...byMeal.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    return {
      window,
      lines,
      totalItems: lines.reduce((sum, l) => sum + l.qty, 0),
      totalOrders: relevant.length,
    };
  });
}
