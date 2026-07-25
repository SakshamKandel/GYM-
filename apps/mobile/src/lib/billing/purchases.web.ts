import type { PurchaseOutcome, RestoreOutcome, StorePackage } from './types';

/**
 * Store billing on the web build.
 *
 * There is no App Store or Google Play here, so every call reports "not
 * available" and the paywall keeps its existing paths: the manual payment rail
 * on the web, and the stores on a phone. Members are never shown a purchase
 * button that could not complete.
 */

export async function configureStoreBilling(_accountId: string): Promise<boolean> {
  return false;
}

export async function getStorePackages(): Promise<StorePackage[]> {
  return [];
}

export async function purchaseStorePackage(_packageKey: string): Promise<PurchaseOutcome> {
  return { kind: 'failed', reason: 'unavailable' };
}

export async function restoreStorePurchases(): Promise<RestoreOutcome> {
  return { kind: 'failed', reason: 'unavailable' };
}
