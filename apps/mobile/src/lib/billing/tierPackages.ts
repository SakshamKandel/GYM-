import type { Tier } from '@gym/shared';
import type { StorePackage, StorePeriod } from './types';

/**
 * Pure mapping between what a store sells and what this product sells.
 *
 * No React, no SDK, no network: the store side of billing is the one place a
 * misread identifier silently sells the wrong thing, so the rules live here on
 * their own and are covered by tierPackages.test.mjs.
 *
 * The naming contract (documented in docs/DEPLOY.md so the operator sets the
 * store up the same way the app reads it):
 *   - a RevenueCat ENTITLEMENT is named exactly after the tier: silver, gold,
 *     elite. The server webhook already reads them that way.
 *   - a package belongs to a tier when the tier name appears in the OFFERING
 *     identifier (preferred, one offering per tier), or failing that in the
 *     product identifier, or failing that in the package identifier.
 *
 * Anything that names two tiers at once, or none, is left unmapped and is never
 * offered. Guessing here would charge somebody for a membership they did not
 * pick.
 */

/** Tiers that cost money. Starter is free and is never sold in a store. */
export const PAID_TIERS = ['silver', 'gold', 'elite'] as const satisfies readonly Tier[];

export type PaidTier = (typeof PAID_TIERS)[number];

/** Low to high, so "best entitlement wins" is a max over this order. */
const PAID_RANK: Record<PaidTier, number> = { silver: 1, gold: 2, elite: 3 };

/** Split an identifier into lowercase word-ish tokens: 'gm_Gold.monthly' → gm, gold, monthly. */
function tokens(identifier: string): string[] {
  return identifier
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 0);
}

/**
 * The single tier an identifier names, or null when it names none or more than
 * one. `$rc_monthly` names none; `silver_to_gold_upgrade` names two.
 */
function tierInIdentifier(identifier: string): PaidTier | null {
  const parts = new Set(tokens(identifier));
  const found = PAID_TIERS.filter((tier) => parts.has(tier));
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Which membership this package sells, or null when the store's naming does not
 * say clearly. Offering first (the recommended one-offering-per-tier setup),
 * then the product, then the package.
 */
export function tierForStorePackage(pkg: StorePackage): PaidTier | null {
  return (
    tierInIdentifier(pkg.offeringId) ??
    tierInIdentifier(pkg.productId) ??
    tierInIdentifier(pkg.packageId)
  );
}

/**
 * The best membership a set of active entitlement ids stands for, or null when
 * none of them is a membership this app knows. Used after a restore, where the
 * store tells us what the account owns rather than what was just bought.
 */
export function tierForEntitlements(entitlementIds: readonly string[]): PaidTier | null {
  let best: PaidTier | null = null;
  for (const id of entitlementIds) {
    const tier = PAID_TIERS.find((candidate) => candidate === id.trim().toLowerCase());
    if (tier && (best === null || PAID_RANK[tier] > PAID_RANK[best])) best = tier;
  }
  return best;
}

/** Sort weight: shortest commitment first, so the cheapest row leads. */
const PERIOD_ORDER: Record<StorePeriod, number> = {
  weekly: 1,
  monthly: 2,
  twoMonth: 3,
  threeMonth: 4,
  sixMonth: 5,
  annual: 6,
  lifetime: 7,
  other: 8,
};

/** Every package that sells `tier`, shortest commitment first. */
export function packagesForTier(
  packages: readonly StorePackage[],
  tier: Tier,
): StorePackage[] {
  // filter() already copies, so the caller's list is never reordered.
  return packages
    .filter((pkg) => tierForStorePackage(pkg) === tier)
    .sort((a, b) => PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period]);
}

/** Every tier the store can actually sell right now. */
export function sellableTiers(packages: readonly StorePackage[]): PaidTier[] {
  return PAID_TIERS.filter((tier) => packages.some((pkg) => tierForStorePackage(pkg) === tier));
}

/** How the billing period reads on screen. */
export function periodLabel(period: StorePeriod): string {
  switch (period) {
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'twoMonth':
      return 'Every 2 months';
    case 'threeMonth':
      return 'Every 3 months';
    case 'sixMonth':
      return 'Every 6 months';
    case 'annual':
      return 'Yearly';
    case 'lifetime':
      return 'One payment, no renewal';
    default:
      return 'Membership';
  }
}

/** Store package types, translated into the periods this app talks about. */
export function periodFromPackageType(packageType: string): StorePeriod {
  switch (packageType.trim().toUpperCase()) {
    case 'WEEKLY':
      return 'weekly';
    case 'MONTHLY':
      return 'monthly';
    case 'TWO_MONTH':
      return 'twoMonth';
    case 'THREE_MONTH':
      return 'threeMonth';
    case 'SIX_MONTH':
      return 'sixMonth';
    case 'ANNUAL':
      return 'annual';
    case 'LIFETIME':
      return 'lifetime';
    default:
      return 'other';
  }
}
