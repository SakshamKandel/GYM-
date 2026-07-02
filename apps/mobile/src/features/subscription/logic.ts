import type { GmTier, Tier } from '@gym/shared';
import { GM_TIERS, TIER_ORDER } from '@gym/shared';

/** Screen-side helpers for the GM Method paywall. Pure, no React. */

export { GM_TIERS, TIER_ORDER };
export type { GmTier };

/** The tier the paywall pushes hardest — the adaptive engine lives here. */
export const RECOMMENDED_TIER: Tier = 'gold';

/** 0-based position in the tier ladder (starter = 0 … elite = 3). */
export function tierRank(tier: Tier): number {
  return TIER_ORDER.indexOf(tier);
}

/** Negative = a is below b, 0 = same, positive = a is above b. */
export function compareTiers(a: Tier, b: Tier): number {
  return tierRank(a) - tierRank(b);
}

export function isUpgrade(from: Tier, to: Tier): boolean {
  return compareTiers(to, from) > 0;
}

/** "1,999" — just the grouped figure, for layouts that style currency/period separately. */
export function formatNprAmount(pricePerMonthNpr: number): string {
  return String(pricePerMonthNpr).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "Free" or "NPR 1,999/mo" — no Intl so it renders identically everywhere. */
export function formatNprPerMonth(pricePerMonthNpr: number): string {
  if (pricePerMonthNpr <= 0) return 'Free';
  return `NPR ${formatNprAmount(pricePerMonthNpr)}/mo`;
}
