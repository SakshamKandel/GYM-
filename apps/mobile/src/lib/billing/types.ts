/**
 * Shared shapes for store billing (Apple App Store / Google Play through
 * RevenueCat). Deliberately free of any SDK import so the web build, the
 * native build and the pure mapping helpers all speak the same language.
 *
 * Nothing here grants anything. The app collects the payment; the server
 * learns about the entitlement from RevenueCat's webhook
 * (apps/web /api/subscription/revenuecat) and stays the only tier authority.
 */

/** How long one purchasable package covers. Never shown raw to a member. */
export type StorePeriod =
  | 'weekly'
  | 'monthly'
  | 'twoMonth'
  | 'threeMonth'
  | 'sixMonth'
  | 'annual'
  | 'lifetime'
  | 'other';

/** One thing a member can buy, already reduced to what the paywall needs. */
export interface StorePackage {
  /** Stable list key AND the handle purchaseStorePackage() buys by. */
  key: string;
  /** Offering the package came from, e.g. 'gold'. Never shown. */
  offeringId: string;
  /** Package identifier inside the offering, e.g. '$rc_monthly'. Never shown. */
  packageId: string;
  /** Store product identifier, e.g. 'gm_gold_monthly'. Never shown. */
  productId: string;
  period: StorePeriod;
  /**
   * The store's own localized price text, e.g. "$9.99" or "रु 1,200". Shown
   * exactly as the store wrote it: it is the only price a member is charged,
   * and both stores require it to be the one on screen.
   */
  priceLabel: string;
}

/** Why a store call could not finish. Mapped to plain copy at the surface. */
export type StoreFailure =
  | 'network'
  | 'store'
  | 'not_allowed'
  | 'unavailable'
  | 'already_owned'
  | 'unknown';

/**
 * The four things a real store does with a purchase: it goes through, the
 * member backs out, it waits for someone else (a parent's approval, a slow
 * payment method), or it fails.
 */
export type PurchaseOutcome =
  | { kind: 'bought'; entitlements: string[] }
  | { kind: 'cancelled' }
  | { kind: 'pending' }
  | { kind: 'failed'; reason: StoreFailure };

/** Restore has the same shape minus the wait: either something came back or nothing did. */
export type RestoreOutcome =
  | { kind: 'found'; entitlements: string[] }
  | { kind: 'none' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: StoreFailure };
