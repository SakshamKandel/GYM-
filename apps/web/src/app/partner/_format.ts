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

/**
 * ONE money renderer for the whole web app. It lives here rather than in
 * @/lib/format because that module already imports this one for the meal-delivery
 * labels below, and a money helper importing back would close a cycle.
 *
 * There used to be three: this one, a second in the partner wallet, and a third
 * in @/lib/format. The first two rendered the same rupee balance as `Rs 250000`
 * and `Rs 250,000` on the SAME earnings screen. This is the wallet's reading —
 * grouped thousands — with @/lib/format's exact-integer arithmetic, so nothing
 * here divides money in floating point: the whole part comes from
 * `(abs - abs % 100) / 100`, exact for every safe integer, and the remainder is
 * two literal digits.
 *
 * Styles differ only in what is written in front of the amount:
 *  - 'local' — `Rs 12,300` / `$45.99`, for the partner portal and its printed
 *    receipts, where a restaurant in Kathmandu reads rupees as rupees.
 *  - 'code'  — `NPR 12,300` / `$45.99`, for the admin and coach consoles, where
 *    staff compare two currencies side by side.
 *  - 'plain' — `250` / `45.99`, bare and ungrouped, for form fields whose own
 *    label carries the currency.
 */
export type MoneyStyle = 'code' | 'local' | 'plain';

/** Currencies displayed without decimals (owner-facing style: whole rupees). */
const ZERO_DECIMAL_CURRENCIES = new Set(['NPR']);

const MONEY_STYLES: Record<
  MoneyStyle,
  { markers: Record<string, string>; fallbackToCode: boolean; group: boolean }
> = {
  code: { markers: { USD: '$' }, fallbackToCode: true, group: true },
  local: { markers: { NPR: 'Rs ', USD: '$' }, fallbackToCode: true, group: true },
  plain: { markers: {}, fallbackToCode: false, group: false },
};

/** `1234567` → `1,234,567`. Digits only — never sees a float. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format an integer minor-unit amount. Negative amounts keep the sign in front
 * of the whole thing (`-NPR 500`), which is how a wallet ledger reads a debit.
 * A non-finite amount renders as an em-dash rather than `NaN` — a money cell
 * that says nothing is safer than one that says something wrong.
 */
export function renderMoney(amountMinor: number, currency: string, style: MoneyStyle): string {
  const code = currency.trim().toUpperCase();
  if (!Number.isFinite(amountMinor)) return '—';
  const rounded = Math.round(amountMinor);
  const abs = Math.abs(rounded);
  // Exact integer split — no `/ 100` on a value that isn't already a multiple.
  const cents = abs % 100;
  const whole = (abs - cents) / 100;
  const { markers, fallbackToCode, group } = MONEY_STYLES[style];
  const wholeText = ZERO_DECIMAL_CURRENCIES.has(code)
    ? String(cents >= 50 ? whole + 1 : whole)
    : String(whole);
  const amount = ZERO_DECIMAL_CURRENCIES.has(code)
    ? group
      ? groupThousands(wholeText)
      : wholeText
    : `${group ? groupThousands(wholeText) : wholeText}.${String(cents).padStart(2, '0')}`;
  const marker = markers[code] ?? (fallbackToCode ? `${code} ` : '');
  return `${rounded < 0 ? '-' : ''}${marker}${amount}`;
}

/** `25000, 'NPR'` → `Rs 250` · `250, 'USD'` → `$2.50`. */
export function formatMoney(amountMinor: number, currency: string): string {
  return renderMoney(amountMinor, currency, 'local');
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
