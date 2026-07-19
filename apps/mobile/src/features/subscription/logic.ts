import * as Localization from 'expo-localization';
import { DEFAULT_TIER_PRICES, resolveRegion, type GmTier, type Tier } from '@gym/shared';
import { GM_TIERS, TIER_ORDER } from '@gym/shared';
import type { CatalogTier, PriceRegion, SubscriptionCatalog } from '../../lib/api/client';

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
// price authority — the paywall reads live prices from the server catalog
// while signed in, and falls back to the shared DEFAULT_TIER_PRICES constant
// (resolved against a device locale hint) when signed out or offline.

/**
 * Device country hint (ISO-3166 alpha-2), e.g. from the phone's region
 * setting — sent to the catalog endpoint and used for the offline/signed-out
 * price fallback. Never throws: an unavailable locale API resolves to
 * undefined (→ INTL fallback).
 */
export function regionHint(): string | undefined {
  try {
    return Localization.getLocales()[0]?.regionCode ?? undefined;
  } catch {
    return undefined;
  }
}

/** The price region the offline/signed-out fallback should use. */
export function fallbackPriceRegion(): PriceRegion {
  return resolveRegion(regionHint());
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

/** DEFAULT_TIER_PRICES row for `tier` in the fallback region (never empty —
 * every tier has a row in every region). */
export function fallbackTierPrice(tier: Tier): { amountMinor: number; currency: string } {
  const region = fallbackPriceRegion();
  const row = DEFAULT_TIER_PRICES.find((p) => p.region === region && p.tier === tier);
  if (row) return { amountMinor: row.amountMinor, currency: row.currency };
  return { amountMinor: 0, currency: region === 'NP' ? 'NPR' : 'USD' };
}

/** Resolved price to render for one tier card/detail sheet. */
export interface TierPriceDisplay {
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
 * discount) when `catalog` is loaded, else the offline/signed-out fallback.
 */
export function tierPriceDisplay(
  tier: Tier,
  catalog: SubscriptionCatalog | null,
): TierPriceDisplay {
  const catalogTier: CatalogTier | undefined = catalog?.tiers.find((t) => t.tier === tier);
  if (catalog && catalogTier) {
    return {
      isFree: catalogTier.amountMinor <= 0,
      currency: catalog.currency,
      baseMinor: catalogTier.amountMinor,
      discountedMinor: catalogTier.discountedMinor ?? null,
      discountPct: catalogTier.discountPct ?? null,
      discountSource: catalogTier.discountSource ?? null,
    };
  }
  const fallback = fallbackTierPrice(tier);
  return {
    isFree: fallback.amountMinor <= 0,
    currency: fallback.currency,
    baseMinor: fallback.amountMinor,
    discountedMinor: null,
    discountPct: null,
    discountSource: null,
  };
}
