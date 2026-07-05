import type { Tier } from './api';

/**
 * Subscription-window helpers shared by the admin + coach tier controls.
 *
 * The server owns tier/expiry truth (accounts.tier + tierExpiresAt); these are
 * pure client helpers to (a) turn a duration choice into an ISO `expiresAt`,
 * and (b) present an expiry a screen already knows about. No network, no state.
 */

/** A duration preset the operator can pick when setting/extending a tier. */
export type DurationChoice = 'days30' | 'days90' | 'days365' | 'permanent' | 'custom';

export interface DurationOption {
  key: DurationChoice;
  label: string;
  /** Days to add from `now`; null = permanent (no expiry); undefined = custom. */
  days: number | null | undefined;
}

/** The picker order: three common windows, then permanent, then a custom date. */
export const DURATION_OPTIONS: readonly DurationOption[] = [
  { key: 'days30', label: '30 days', days: 30 },
  { key: 'days90', label: '90 days', days: 90 },
  { key: 'days365', label: '1 year', days: 365 },
  { key: 'permanent', label: 'Permanent', days: null },
  { key: 'custom', label: 'Custom date', days: undefined },
] as const;

/** Milliseconds in a day — window math is day-granular. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a duration choice to the `expiresAt` value for the tier payload:
 *   - a day count → an ISO string `days` days after `from`
 *   - permanent   → null (clears any expiry)
 *   - custom      → the caller supplies its own ISO (this returns undefined so
 *                   the caller substitutes the chosen date)
 * Starter is always permanent regardless of the picked window, so callers that
 * set 'starter' should pass null anyway; this helper stays tier-agnostic.
 */
export function expiresAtFor(
  option: DurationOption,
  from: Date = new Date(),
): string | null | undefined {
  if (option.days === null) return null; // permanent
  if (option.days === undefined) return undefined; // custom — caller decides
  return new Date(from.getTime() + option.days * DAY_MS).toISOString();
}

/** A calendar date (local midnight) → an ISO string for a custom expiry. */
export function isoFromDateParts(year: number, month1to12: number, day: number): string {
  // month is 0-indexed in the Date constructor.
  return new Date(year, month1to12 - 1, day, 23, 59, 59, 0).toISOString();
}

/** Y/M/D parts (1-indexed month) for the custom-date pickers. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * A sensible default for the custom-date pickers: `daysAhead` (90) days from
 * now, broken into local Y/M/D parts. Kept as a plain helper so screens read
 * the clock in a `useState` lazy initializer, never during render (React
 * purity).
 */
export function defaultCustomDateParts(daysAhead = 90, from: Date = new Date()): DateParts {
  const d = new Date(from.getTime() + daysAhead * DAY_MS);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** True when the ISO expiry is a valid instant strictly before `now`. */
export function isLapsed(expiresAtIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAtIso) return false;
  const ms = Date.parse(expiresAtIso);
  if (Number.isNaN(ms)) return false;
  return ms < now.getTime();
}

/**
 * Human expiry line for a tier control — "Permanent", "Expired {date}", or
 * "Expires {date}". `null`/undefined reads as permanent; an unparseable string
 * reads as unknown rather than crashing.
 */
export function expiryLabel(
  expiresAtIso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (expiresAtIso === null || expiresAtIso === undefined) return 'Permanent';
  const ms = Date.parse(expiresAtIso);
  if (Number.isNaN(ms)) return 'Unknown expiry';
  const when = new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return ms < now.getTime() ? `Expired ${when}` : `Expires ${when}`;
}

/** Days remaining until expiry (0 if lapsed / permanent / unknown). */
export function daysLeft(
  expiresAtIso: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!expiresAtIso) return 0;
  const ms = Date.parse(expiresAtIso);
  if (Number.isNaN(ms)) return 0;
  const diff = ms - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / DAY_MS);
}

/**
 * 'starter' can never carry an expiry (it's the permanent free floor). A UI
 * that lets the operator flip to starter should force the window to permanent.
 */
export function tierAllowsExpiry(tier: Tier): boolean {
  return tier !== 'starter';
}
