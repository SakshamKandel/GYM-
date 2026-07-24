/**
 * Regional pricing — the shared price catalog, discount math, and money
 * formatting used by the subscription catalog endpoint, the paywall, and the
 * admin pricing editor. Pure logic, no I/O (CLAUDE.md rule 10). Money is
 * always integer minor units (paisa/cents) + an ISO-ish currency code string
 * — never floats (SCALE-UP-PLAN §6 rule 5).
 *
 * SCALE-UP-PLAN §1.1: two price regions. `NP` gets the persisted NPR catalog
 * and everything else clamps to the persisted `INTL` catalog. Prices are
 * deliberately absent here: `tier_prices` is the only source of truth, and
 * incomplete configuration must surface as unavailable.
 */

export type PriceRegion = 'NP' | 'INTL';

/**
 * Clamp a client-supplied country hint (ISO-3166 alpha-2, e.g. from
 * `expo-localization`) to a price region. Only `NP` gets the Nepal catalog;
 * every other value — including null/undefined/empty/garbage — clamps to
 * `INTL`. Case-insensitive, trims whitespace.
 */
export function resolveRegion(countryHint?: string | null): PriceRegion {
  if (!countryHint) return 'INTL';
  return countryHint.trim().toUpperCase() === 'NP' ? 'NP' : 'INTL';
}

/**
 * Apply a percentage discount to a minor-unit amount. Rounds HALF UP (0.5
 * rounds away from zero toward the higher minor unit) and floors the result
 * at 0 (a >100% pct — which should never happen, but callers are not
 * trusted — never yields a negative price).
 *
 * Returns the DISCOUNTED price (not the discount amount).
 */
export function applyDiscount(amountMinor: number, pct: number): number {
  const raw = (amountMinor * (100 - pct)) / 100;
  const rounded = Math.floor(raw + 0.5);
  return Math.max(0, rounded);
}

/** Currencies with no decimal display (owner-facing style: whole rupees only). */
const ZERO_DECIMAL_CURRENCIES = new Set(['NPR']);

/** Symbol-prefixed (no space) currencies; everything else gets "CODE amount". */
const SYMBOL_PREFIX: Record<string, string> = { USD: '$' };

/**
 * Format a minor-unit amount for display WITHOUT depending on Intl/ICU data
 * being present at runtime (mobile/edge runtimes are not guaranteed full-ICU).
 * `formatMoney(49900, 'NPR')` → "NPR 499"; `formatMoney(499, 'USD')` → "$4.99".
 * Unknown currencies fall back to "CODE 4.99" (2-decimal major units).
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) {
    const whole = Math.round(amountMinor / 100);
    return `${code} ${whole}`;
  }
  const major = (amountMinor / 100).toFixed(2);
  const symbol = SYMBOL_PREFIX[code];
  return symbol ? `${symbol}${major}` : `${code} ${major}`;
}
