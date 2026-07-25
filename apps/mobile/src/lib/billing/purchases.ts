import { storeApiKey } from './config';
import { periodFromPackageType } from './tierPackages';
import type { PurchaseOutcome, RestoreOutcome, StoreFailure, StorePackage } from './types';

/**
 * The app's half of store billing: talk to RevenueCat, hand the payment to
 * Apple or Google, and report exactly what happened.
 *
 * Three rules this file never breaks:
 *  1. It grants nothing. A purchase here is only ever a payment. The tier lands
 *     when RevenueCat's webhook reaches the server, which is the sole authority.
 *  2. It never throws into the UI. Every call resolves to a described outcome.
 *  3. It is a clean no-op when it cannot work: no key in the build, no native
 *     module (Expo Go, or before the dependency is installed), or the SDK
 *     refusing to start. Callers see "not available" and hide the entry point
 *     rather than showing a button that cannot do anything.
 *
 * The SDK is loaded through a guarded require rather than a top-level import so
 * a build without the native module still runs. `react-native-purchases` is
 * declared in package.json; run `pnpm install` before the first native build.
 */

// ── The slice of the RevenueCat SDK this app uses ────────────────────────────
// Described structurally so this file compiles and bundles with or without the
// package present, and so nothing but these calls can ever be reached.

interface SdkProduct {
  identifier?: string;
  priceString?: string;
}

interface SdkPackage {
  identifier?: string;
  packageType?: string;
  offeringIdentifier?: string;
  product?: SdkProduct;
}

interface SdkOffering {
  identifier?: string;
  availablePackages?: SdkPackage[];
}

interface SdkOfferings {
  current?: SdkOffering | null;
  all?: Record<string, SdkOffering>;
}

interface SdkCustomerInfo {
  entitlements?: { active?: Record<string, unknown> };
}

interface PurchasesSdk {
  configure(options: { apiKey: string; appUserID?: string }): void;
  logIn(appUserID: string): Promise<{ customerInfo?: SdkCustomerInfo }>;
  getOfferings(): Promise<SdkOfferings>;
  purchasePackage(pkg: SdkPackage): Promise<{ customerInfo?: SdkCustomerInfo }>;
  restorePurchases(): Promise<SdkCustomerInfo>;
}

function isPurchasesSdk(value: unknown): value is PurchasesSdk {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.configure === 'function' &&
    typeof candidate.logIn === 'function' &&
    typeof candidate.getOfferings === 'function' &&
    typeof candidate.purchasePackage === 'function' &&
    typeof candidate.restorePurchases === 'function'
  );
}

/** undefined = not looked for yet, null = not usable in this build. */
let sdk: PurchasesSdk | null | undefined;

function loadSdk(): PurchasesSdk | null {
  if (sdk !== undefined) return sdk;
  sdk = null;
  try {
    const loaded: unknown = require('react-native-purchases');
    const exported =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? (loaded as { default: unknown }).default
        : loaded;
    if (isPurchasesSdk(exported)) sdk = exported;
  } catch {
    // No native module in this build. Store billing simply stays off.
    sdk = null;
  }
  return sdk;
}

/** The account the SDK is currently talking for, or null before setup. */
let configuredFor: string | null = null;

/** The live packages, kept here so callers hold a plain key and never an SDK object. */
const packagesByKey = new Map<string, SdkPackage>();

/**
 * Point the store at this account and get ready to sell. `accountId` MUST be
 * the server account id: it is what RevenueCat sends back as `app_user_id`, and
 * the webhook finds the account by it. Resolves false whenever store billing is
 * not part of this build or could not start, which is not an error state.
 */
export async function configureStoreBilling(accountId: string): Promise<boolean> {
  const apiKey = storeApiKey();
  if (!apiKey || !accountId) return false;
  const store = loadSdk();
  if (!store) return false;
  if (configuredFor === accountId) return true;

  try {
    if (configuredFor === null) {
      store.configure({ apiKey, appUserID: accountId });
    } else {
      // A different member signed in on this device. Move the store session
      // over, otherwise their purchase would be filed under the old account.
      await store.logIn(accountId);
    }
    configuredFor = accountId;
    return true;
  } catch (error) {
    console.warn('[billing] store setup did not complete', error);
    return false;
  }
}

/**
 * Everything on sale for the configured account, flattened across offerings.
 * An empty list means nothing can be bought right now (offline, no products
 * approved yet, store not set up) and the caller hides the purchase entry.
 */
export async function getStorePackages(): Promise<StorePackage[]> {
  const store = loadSdk();
  if (!store || configuredFor === null) return [];

  let offerings: SdkOfferings;
  try {
    offerings = await store.getOfferings();
  } catch {
    return [];
  }

  const offeringList: SdkOffering[] = [];
  for (const offering of Object.values(offerings.all ?? {})) {
    if (offering) offeringList.push(offering);
  }
  if (offerings.current && !offeringList.includes(offerings.current)) {
    offeringList.push(offerings.current);
  }

  const found = new Map<string, SdkPackage>();
  const list: StorePackage[] = [];
  for (const offering of offeringList) {
    const offeringId = offering.identifier ?? '';
    for (const pkg of offering.availablePackages ?? []) {
      const packageId = pkg.identifier ?? '';
      const priceLabel = pkg.product?.priceString?.trim() ?? '';
      const key = `${offeringId}:${packageId}`;
      // No price from the store means nothing honest to put on the button.
      if (!packageId || !priceLabel || found.has(key)) continue;
      found.set(key, pkg);
      list.push({
        key,
        offeringId,
        packageId,
        productId: pkg.product?.identifier ?? '',
        period: periodFromPackageType(pkg.packageType ?? ''),
        priceLabel,
      });
    }
  }

  packagesByKey.clear();
  for (const [key, pkg] of found) packagesByKey.set(key, pkg);
  return list;
}

/**
 * Hand the payment to the store. Resolves to what actually happened: bought,
 * backed out, waiting for approval, or failed with a reason. Never throws.
 *
 * A 'bought' outcome means the STORE took the money. It does not mean the
 * membership is on: the caller re-reads the account from the server and says so
 * plainly while it waits for the webhook.
 */
export async function purchaseStorePackage(packageKey: string): Promise<PurchaseOutcome> {
  const store = loadSdk();
  const pkg = packagesByKey.get(packageKey);
  if (!store || configuredFor === null || !pkg) {
    return { kind: 'failed', reason: 'unavailable' };
  }
  try {
    const result = await store.purchasePackage(pkg);
    return { kind: 'bought', entitlements: activeEntitlements(result?.customerInfo) };
  } catch (error) {
    const classified = classifyStoreError(error);
    if (classified === 'cancelled') return { kind: 'cancelled' };
    if (classified === 'pending') return { kind: 'pending' };
    return { kind: 'failed', reason: classified };
  }
}

/**
 * Bring back a membership already bought on this store account (new phone,
 * reinstall, or a purchase whose confirmation never arrived). Apple requires
 * this to be reachable, and it is the first thing support asks a member to try.
 */
export async function restoreStorePurchases(): Promise<RestoreOutcome> {
  const store = loadSdk();
  if (!store || configuredFor === null) return { kind: 'failed', reason: 'unavailable' };
  try {
    const customerInfo = await store.restorePurchases();
    const entitlements = activeEntitlements(customerInfo);
    return entitlements.length > 0 ? { kind: 'found', entitlements } : { kind: 'none' };
  } catch (error) {
    const classified = classifyStoreError(error);
    if (classified === 'cancelled') return { kind: 'cancelled' };
    // Nothing is pending on a restore; treat that shape as a plain retry.
    if (classified === 'pending') return { kind: 'failed', reason: 'store' };
    return { kind: 'failed', reason: classified };
  }
}

/** Entitlement ids the store says are active right now. */
function activeEntitlements(customerInfo: SdkCustomerInfo | undefined): string[] {
  const active = customerInfo?.entitlements?.active;
  if (typeof active !== 'object' || active === null) return [];
  return Object.keys(active);
}

// ── Error classification ─────────────────────────────────────────────────────
// RevenueCat reports both a numeric code and, depending on platform and
// version, its name. Both spellings are matched so a version bump cannot turn a
// known outcome into "something went wrong".

type StoreErrorKind = StoreFailure | 'cancelled' | 'pending';
type NamedErrorKind = Exclude<StoreErrorKind, 'unknown'>;

/** Every kind that has known codes, in match order. */
const NAMED_KINDS: NamedErrorKind[] = [
  'cancelled',
  'pending',
  'network',
  'store',
  'not_allowed',
  'unavailable',
  'already_owned',
];

const CODES: Record<NamedErrorKind, readonly string[]> = {
  cancelled: ['1', 'PURCHASE_CANCELLED_ERROR', 'PURCHASE_CANCELLED'],
  pending: ['19', 'PAYMENT_PENDING_ERROR', 'PAYMENT_PENDING'],
  network: ['10', 'NETWORK_ERROR', '35', 'OFFLINE_CONNECTION_ERROR'],
  store: ['2', 'STORE_PROBLEM_ERROR', '12', 'UNEXPECTED_BACKEND_RESPONSE_ERROR'],
  not_allowed: [
    '3',
    'PURCHASE_NOT_ALLOWED_ERROR',
    '4',
    'PURCHASE_INVALID_ERROR',
    '11',
    'INVALID_CREDENTIALS_ERROR',
  ],
  unavailable: [
    '5',
    'PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR',
    '23',
    'PRODUCT_NOT_FOR_SALE_ERROR',
    '13',
    'INVALID_APP_USER_ID_ERROR',
  ],
  already_owned: [
    '6',
    'PRODUCT_ALREADY_PURCHASED_ERROR',
    '7',
    'RECEIPT_ALREADY_IN_USE_ERROR',
  ],
};

/** Read the shape RevenueCat rejects with, without trusting any of it. */
function classifyStoreError(error: unknown): StoreErrorKind {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const shape = error as { userCancelled?: unknown; code?: unknown };
  if (shape.userCancelled === true) return 'cancelled';
  const code =
    typeof shape.code === 'string' || typeof shape.code === 'number'
      ? String(shape.code).trim().toUpperCase()
      : null;
  if (!code) return 'unknown';
  for (const kind of NAMED_KINDS) {
    if (CODES[kind].includes(code)) return kind;
  }
  return 'unknown';
}
