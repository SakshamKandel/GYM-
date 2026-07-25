import {
  DIET_LABEL,
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_LABEL,
  PAYMENT_STATUS_LABEL,
  formatDateLabel,
  windowLabel,
  windowShort,
  type BadgeTone,
} from '@/app/partner/_format';

/**
 * ONE money + date formatter for every console surface (admin, coach, partner
 * shells all render the same numbers, so they must render them the same way).
 *
 * Before this module the same rupee amount appeared as `NPR 12300`, `Rs 12,300`
 * and `NPR 12,300.00` on three pages, and dates as `Jul 20`, `20/07/2026` and
 * `Jul 20, 2026, 2:30 PM` depending on which page you happened to be on.
 *
 * Money rule (CLAUDE.md / SCALE-UP-PLAN §6 rule 5): amounts are ALWAYS integer
 * minor units (paisa / cents) plus a currency code. Nothing here divides by 100
 * in floating point — the whole part is derived with `(abs - abs % 100) / 100`,
 * which is exact for every safe integer, and the remainder is rendered as two
 * literal digits. `parseMoneyInput` is the inverse for the few admin forms that
 * take major units from a human.
 *
 * Pure + client-safe: no 'server-only' marker, no I/O, no React. Importable
 * from server components and 'use client' modules alike.
 */

/** Currencies displayed without decimals (owner-facing style: whole rupees). */
const ZERO_DECIMAL_CURRENCIES = new Set(['NPR']);

/** Symbol-prefixed (no space) currencies; everything else gets "CODE amount". */
const SYMBOL_PREFIX: Record<string, string> = { USD: '$' };

/** `1234567` → `1,234,567`. Digits only — never sees a float. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format an integer minor-unit amount: `formatMoney(1230000, 'NPR')` →
 * `NPR 12,300`, `formatMoney(4599, 'USD')` → `$45.99`, unknown codes →
 * `EUR 45.99`. Negative amounts keep the sign in front of the whole thing
 * (`-NPR 500`), which is how the wallet ledger reads a debit.
 *
 * A non-finite amount renders as an em-dash rather than `NaN` — a money cell
 * that says nothing is safer than one that says something wrong.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!Number.isFinite(amountMinor)) return '—';
  const rounded = Math.round(amountMinor);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  // Exact integer split — no `/ 100` on a value that isn't already a multiple.
  const cents = abs % 100;
  const whole = (abs - cents) / 100;
  const symbol = SYMBOL_PREFIX[code];
  const amount = ZERO_DECIMAL_CURRENCIES.has(code)
    ? groupThousands(String(cents >= 50 ? whole + 1 : whole))
    : `${groupThousands(String(whole))}.${String(cents).padStart(2, '0')}`;
  const body = symbol ? `${symbol}${amount}` : `${code} ${amount}`;
  return negative ? `-${body}` : body;
}

/**
 * Major units for a form field, e.g. `25000, 'NPR'` → `250`, `4599, 'USD'` →
 * `45.99`. Bare number, no code or symbol — the field's own label carries the
 * currency. Same integer-exact split as {@link formatMoney}.
 */
export function formatMoneyInput(amountMinor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!Number.isFinite(amountMinor)) return '';
  const rounded = Math.round(amountMinor);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const cents = abs % 100;
  const whole = (abs - cents) / 100;
  const body = ZERO_DECIMAL_CURRENCIES.has(code)
    ? String(cents >= 50 ? whole + 1 : whole)
    : `${whole}.${String(cents).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Inverse of {@link formatMoneyInput} — a human-typed major-unit string to
 * integer minor units, without float rounding drift (`'12.30'` → `1230`, not
 * `1229.9999`). Returns null for anything that isn't a plain amount.
 */
export function parseMoneyInput(raw: string): number | null {
  const text = raw.trim().replace(/,/g, '');
  if (!/^-?\d*(\.\d{0,2})?$/.test(text) || text === '' || text === '-' || text === '.') return null;
  const negative = text.startsWith('-');
  const [whole = '0', frac = ''] = text.replace('-', '').split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isFinite(minor)) return null;
  return negative ? -minor : minor;
}

// One locale for the whole console so a date never depends on which machine
// rendered it (server or browser) — a locale-sensitive format is also a
// hydration mismatch waiting to happen.
const LOCALE = 'en-US';

const DATE_FMT = new Intl.DateTimeFormat(LOCALE, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const DATE_TIME_FMT = new Intl.DateTimeFormat(LOCALE, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Compact stamp for dense table cells — no year (`Jul 20, 2:30 PM`). */
const SHORT_DATE_TIME_FMT = new Intl.DateTimeFormat(LOCALE, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const TIME_FMT = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `Jul 20, 2026`. Unparseable / missing input renders as an em-dash. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? DATE_FMT.format(d) : '—';
}

/** `Jul 20, 2026, 2:30 PM` — use wherever the hour matters (queues, audit). */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? DATE_TIME_FMT.format(d) : '—';
}

/** `Jul 20, 2:30 PM` — dense table cells where the year is noise. */
export function formatShortDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? SHORT_DATE_TIME_FMT.format(d) : '—';
}

/** `2:30 PM` — chat bubbles and other same-day lists. */
export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? TIME_FMT.format(d) : '—';
}

/**
 * Short age for a queue's "how long has this been waiting" column: `now`,
 * `12m`, `5h`, `9d`, then an absolute date past a month. Never renders a
 * negative age (a clock-skewed future stamp reads as `now`).
 */
export function formatAge(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return formatDate(d);
}

/**
 * Human labels for the meal-delivery enums, re-exported from the partner
 * portal's display layer so the admin console and the restaurant see the SAME
 * words for the same row. Admin drawers used to print the raw database strings
 * (`out_for_delivery`, `receipt_submitted`, `cod`) at the exact moment an
 * operator was deciding about someone's food.
 *
 * This is a deliberate re-export, not a copy: two label maps for one enum drift
 * the day someone renames a status in only one of them.
 */
export {
  DIET_LABEL,
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_LABEL,
  PAYMENT_STATUS_LABEL,
  formatDateLabel,
  windowLabel,
  windowShort,
};
export type { BadgeTone };
