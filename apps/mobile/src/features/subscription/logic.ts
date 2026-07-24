import * as Localization from 'expo-localization';
import { type GmTier, type Tier } from '@gym/shared';
import { GM_TIERS, TIER_ORDER } from '@gym/shared';
import type { CatalogTier, SubscriptionCatalog } from '../../lib/api/client';

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

// ── Regional pricing (SCALE-UP-PLAN §1.1 / §5.1) ──────────────────────────
//
// GM_TIERS keeps its feature copy (name/tagline/features) but is no longer the
// price authority — the paywall reads validated live prices from the server.
// Missing/offline pricing is shown as unavailable, never replaced by compiled prices.

/**
 * Device country hint (ISO-3166 alpha-2), e.g. from the phone's region
 * setting — sent to the catalog endpoint so the backend can select its
 * persisted regional catalog. Never throws: an unavailable locale API resolves to
 * undefined (→ the backend selects INTL).
 */
export function regionHint(): string | undefined {
  try {
    return Localization.getLocales()[0]?.regionCode ?? undefined;
  } catch {
    return undefined;
  }
}

// ── Tier expiry (Pack J) ──────────────────────────────────────────────────

/** Resolved expiry state for a membership window, for the renew/expiry copy. */
export interface TierExpiryInfo {
  /** Whole days until expiry (ceil; negative once past). null when no expiry. */
  daysLeft: number | null;
  /** True only when a real expiry exists and is strictly in the past. */
  expired: boolean;
  /** Localized date, e.g. "Jul 25, 2026", or null when there's no expiry. */
  dateLabel: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Interpret an account's `tierExpiresAt` (raw ISO from /api/me) for the paywall
 * expiry banner and membership-card line. Pure — no I/O. A null/undefined or
 * unparseable value is "no expiry" (free/permanent): daysLeft null, not expired.
 */
export function tierExpiryInfo(
  tierExpiresAt: string | null | undefined,
  now: Date = new Date(),
): TierExpiryInfo {
  if (!tierExpiresAt) return { daysLeft: null, expired: false, dateLabel: null };
  const ms = Date.parse(tierExpiresAt);
  if (Number.isNaN(ms)) return { daysLeft: null, expired: false, dateLabel: null };
  const dateLabel = new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return {
    daysLeft: Math.ceil((ms - now.getTime()) / DAY_MS),
    expired: ms < now.getTime(),
    dateLabel,
  };
}

/** Resolved price to render for one tier card/detail sheet. */
export interface TierPriceDisplay {
  available: boolean;
  isFree: boolean;
  currency: string;
  /** Pre-discount catalog price, minor units. */
  baseMinor: number;
  /** Present only when an active discount grant applies. */
  discountedMinor: number | null;
  discountPct: number | null;
  discountSource: 'referral' | 'promo' | null;
}

/**
 * Resolve what to show for `tier`: the live catalog entry (with any active
 * discount) when `catalog` is loaded, otherwise an explicit unavailable state.
 */
export function tierPriceDisplay(
  tier: Tier,
  catalog: SubscriptionCatalog | null,
): TierPriceDisplay {
  const catalogTier: CatalogTier | undefined = catalog?.tiers.find((t) => t.tier === tier);
  if (catalog && catalogTier) {
    return {
      available: true,
      isFree: catalogTier.amountMinor <= 0,
      currency: catalog.currency,
      baseMinor: catalogTier.amountMinor,
      discountedMinor: catalogTier.discountedMinor ?? null,
      discountPct: catalogTier.discountPct ?? null,
      discountSource: catalogTier.discountSource ?? null,
    };
  }
  return {
    available: false,
    isFree: false,
    currency: '',
    baseMinor: 0,
    discountedMinor: null,
    discountPct: null,
    discountSource: null,
  };
}
