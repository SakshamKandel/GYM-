/**
 * Tips pure logic — suggested tip presets and the server-side bound check that
 * makes a tip safe to persist (Pack D; §7.2-S5). No I/O (CLAUDE.md rule 10).
 * All amounts are integer minor units (paisa/cents). Tips are SERVER-repriced;
 * the client's proposed `tipMinor` is only ever a hint that must pass
 * {@link validateTipMinor} before it touches an order total.
 */

/** Preset tip percentages offered at checkout / post-delivery. */
export const TIP_PERCENTS: readonly number[] = [0, 10, 15, 20];

/**
 * Absolute safety ceiling on any single tip (overflow / fat-finger guard),
 * independent of currency. A tip above this is always rejected regardless of
 * subtotal. Rs/$ 100,000 in minor units.
 */
export const TIP_MAX_MINOR = 100_000_00;

/** A suggested tip preset: the percentage and its computed minor amount. */
export interface TipOption {
  percent: number;
  amountMinor: number;
}

/**
 * The preset tip options for a given subtotal. Each amount is the percentage of
 * the subtotal rounded to the nearest minor unit. Negative/zero/NaN subtotals
 * collapse to a 0 base (all presets 0) rather than throwing.
 */
export function tipOptions(subtotalMinor: number): TipOption[] {
  const base = Number.isFinite(subtotalMinor) ? Math.max(0, Math.trunc(subtotalMinor)) : 0;
  return TIP_PERCENTS.map((percent) => ({
    percent,
    amountMinor: Math.round((base * percent) / 100),
  }));
}

/** Why a proposed tip was rejected. */
export type TipRejectReason = 'not_integer' | 'negative' | 'exceeds_cap';

/** Result of validating a proposed tip. `tipMinor` is the safe value to persist. */
export interface TipValidation {
  ok: boolean;
  tipMinor: number;
  reason?: TipRejectReason;
}

/**
 * Validate a proposed tip before it is applied server-side. A tip must be a
 * non-negative integer no greater than the cap. When a `subtotalMinor` is
 * supplied the cap is the tighter of the absolute ceiling and 5× the subtotal
 * (a tip many times the meal cost is almost certainly a bug/abuse). On rejection
 * the returned `tipMinor` is 0 (fail-safe: no tip rather than a bad tip).
 */
export function validateTipMinor(tipMinor: number, subtotalMinor?: number): TipValidation {
  if (!Number.isInteger(tipMinor)) return { ok: false, tipMinor: 0, reason: 'not_integer' };
  if (tipMinor < 0) return { ok: false, tipMinor: 0, reason: 'negative' };
  const relativeCap =
    typeof subtotalMinor === 'number' && Number.isFinite(subtotalMinor) && subtotalMinor > 0
      ? Math.trunc(subtotalMinor) * 5
      : TIP_MAX_MINOR;
  const cap = Math.min(TIP_MAX_MINOR, relativeCap);
  if (tipMinor > cap) return { ok: false, tipMinor: 0, reason: 'exceeds_cap' };
  return { ok: true, tipMinor };
}
