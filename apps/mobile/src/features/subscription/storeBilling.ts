import { useCallback, useEffect, useRef, useState } from 'react';
import { compareTiers, type Tier } from '@gym/shared';
import type { SubscriptionCatalog } from '../../lib/api/client';
import {
  configureStoreBilling,
  getStorePackages,
  packagesForTier,
  purchaseStorePackage,
  restoreStorePurchases,
  sellableTiers,
  storeApiKey,
  storeName,
  tierForEntitlements,
  type StoreFailure,
  type StorePackage,
} from '../../lib/billing';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { tierName } from '../../lib/tier';
import { useAuth } from '../../state/auth';

/**
 * Buying a membership in the app stores.
 *
 * The shape of the deal: the app takes the payment through Apple or Google, the
 * STORE confirms it to RevenueCat, and RevenueCat tells the server, which is
 * the only thing allowed to turn a membership on. So nothing here writes a
 * tier. After a payment goes through we re-read the account from the server,
 * and if the confirmation has not arrived yet we say exactly that instead of
 * pretending the membership is live.
 *
 * The purchase entry point only exists when all of this is true:
 *   - the phone can pay (iOS or Android, never the web build),
 *   - this build carries a RevenueCat key,
 *   - the store SDK started for the signed-in account,
 *   - the server says billing is live, so the webhook can grant what is bought,
 *   - and the store actually has something on sale for that membership.
 * Anything missing and the paywall keeps the paths it already had. There is
 * never a button that cannot finish.
 */

/** What the flow is doing right now. */
export type StoreActivity = 'idle' | 'buying' | 'confirming' | 'restoring';

export type StoreNoticeTone = 'good' | 'quiet' | 'bad';

/** One line of plain feedback to show under the buttons. */
export interface StoreNoticeBody {
  tone: StoreNoticeTone;
  message: string;
}

/**
 * The same line, tagged with which action produced it, so a purchase result
 * never turns up underneath the restore button and vice versa.
 */
export interface StoreNotice extends StoreNoticeBody {
  from: 'buy' | 'restore';
}

export interface StoreBilling {
  /** Still working out what the store can sell. Say nothing either way yet. */
  loading: boolean;
  /** True only when at least one membership can really be bought right now. */
  available: boolean;
  /** True when this exact membership can be bought right now. */
  canBuy: (tier: Tier) => boolean;
  /** What is on sale for this membership, shortest commitment first. */
  packagesFor: (tier: Tier) => StorePackage[];
  activity: StoreActivity;
  notice: StoreNotice | null;
  /** "the App Store" / "Google Play", for copy that names where money goes. */
  storeLabel: string;
  buy: (pkg: StorePackage, tier: Tier) => void;
  restore: () => void;
  /** Clear the last notice, e.g. when reopening the sheet. */
  reset: () => void;
}

/**
 * How long to keep re-reading the account after a payment before admitting the
 * confirmation has not landed yet. Roughly ten seconds in total, which covers
 * the normal webhook round trip without holding a spinner hostage.
 */
const CONFIRM_STEPS_MS = [1_000, 2_000, 3_000, 4_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Does the server-verified account already carry this membership (or better)? */
function serverHasTier(target: Tier): boolean {
  const current = useAuth.getState().user?.tier ?? 'starter';
  return compareTiers(current, target) >= 0;
}

/**
 * Re-read the account until the server shows the membership, or give up and let
 * the caller say so honestly. Stops early if the session changed underneath.
 */
async function confirmWithServer(target: Tier): Promise<boolean> {
  const token = useAuth.getState().token;
  if (serverHasTier(target)) return true;
  for (const wait of CONFIRM_STEPS_MS) {
    await sleep(wait);
    if (useAuth.getState().token !== token) return false;
    await useAuth.getState().refresh();
    if (serverHasTier(target)) return true;
  }
  return false;
}

// ── Copy ────────────────────────────────────────────────────────────────────
// Pure, so the wording is one hop from a test and never assembled inline.

/** Why a store call could not finish, in words a member can act on. */
export function storeFailureLine(reason: StoreFailure): string {
  switch (reason) {
    case 'network':
      return 'We could not reach the store. Check your connection and try again.';
    case 'store':
      return 'The store had a problem just now. Please try again in a bit.';
    case 'not_allowed':
      return 'Purchases are turned off for this device or store account.';
    case 'unavailable':
      return 'That membership is not on sale in your store right now.';
    case 'already_owned':
      return 'You already own this membership. Tap Restore purchases to bring it back.';
    default:
      return 'The payment did not go through. Please try again in a bit.';
  }
}

/** What to say once a payment has been taken by the store. */
export function purchasedLine(tier: Tier, confirmed: boolean): StoreNoticeBody {
  return confirmed
    ? { tone: 'good', message: `Your ${tierName(tier)} membership is active.` }
    : {
        tone: 'quiet',
        message: `Thanks, your payment went through. Your ${tierName(
          tier,
        )} membership switches on as soon as the store confirms it, usually within a minute. You can close this and carry on.`,
      };
}

/** What to say when the store is waiting on someone else before it charges. */
export function pendingLine(tier: Tier): StoreNoticeBody {
  return {
    tone: 'quiet',
    message: `Your payment still needs to be approved. Your ${tierName(
      tier,
    )} membership switches on as soon as it clears, and you can keep using the app in the meantime.`,
  };
}

/** What to say after a restore, given what the store handed back. */
export function restoredLine(tier: Tier | null, confirmed: boolean): StoreNoticeBody {
  if (tier === null) {
    return {
      tone: 'bad',
      message:
        'We found a purchase on this store account, but it does not match a membership here. Contact support and we will sort it out.',
    };
  }
  return confirmed
    ? { tone: 'good', message: `Your ${tierName(tier)} membership is back.` }
    : {
        tone: 'quiet',
        message: `We found your purchase. Your ${tierName(
          tier,
        )} membership switches on as soon as the store confirms it. If it has not in a few minutes, contact support and we will sort it out.`,
      };
}

// ── The flow ────────────────────────────────────────────────────────────────

/**
 * Everything the paywall needs to sell a membership through the stores.
 * `catalog` is the server's live pricing response: its billing mode is what
 * says whether a store purchase can actually be honoured.
 */
export function useStoreBilling(catalog: SubscriptionCatalog | null): StoreBilling {
  const accountId = useAuth((s) => s.user?.id ?? null);
  const billingIsLive = catalog?.billingMode === 'live';

  const [packages, setPackages] = useState<StorePackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState<StoreActivity>('idle');
  const [notice, setNotice] = useState<StoreNotice | null>(null);

  // Guards so a late store or server answer can never write into a screen that
  // has gone away, or fight a second tap.
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!billingIsLive || !accountId || storeApiKey() === null) {
      setPackages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const ready = await configureStoreBilling(accountId);
      const found = ready ? await getStorePackages() : [];
      if (cancelled) return;
      setPackages(found);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [billingIsLive, accountId]);

  const packagesFor = useCallback(
    (tier: Tier): StorePackage[] => packagesForTier(packages, tier),
    [packages],
  );

  const canBuy = useCallback(
    (tier: Tier): boolean => packagesForTier(packages, tier).length > 0,
    [packages],
  );

  const finish = useCallback((from: 'buy' | 'restore', body: StoreNoticeBody | null): void => {
    if (!aliveRef.current) return;
    setActivity('idle');
    setNotice(body === null ? null : { ...body, from });
  }, []);

  const buy = useCallback(
    (pkg: StorePackage, tier: Tier): void => {
      if (busyRef.current) return;
      busyRef.current = true;
      setNotice(null);
      setActivity('buying');
      void (async () => {
        try {
          const outcome = await purchaseStorePackage(pkg.key);
          if (outcome.kind === 'cancelled') {
            // Nothing went wrong and nothing was charged. Saying so would only
            // read as an error, so the sheet just comes back as it was.
            finish('buy', null);
            return;
          }
          if (outcome.kind === 'failed') {
            warnHaptic();
            finish('buy', { tone: 'bad', message: storeFailureLine(outcome.reason) });
            return;
          }
          if (outcome.kind === 'pending') {
            finish('buy', pendingLine(tier));
            return;
          }
          // The store's own word on what was bought beats the tapped card: if
          // the products are wired to a different membership, the member is
          // told what they actually got.
          const boughtTier = tierForEntitlements(outcome.entitlements) ?? tier;
          if (aliveRef.current) setActivity('confirming');
          const confirmed = await confirmWithServer(boughtTier);
          if (aliveRef.current) successHaptic();
          finish('buy', purchasedLine(boughtTier, confirmed));
        } finally {
          busyRef.current = false;
        }
      })();
    },
    [finish],
  );

  const restore = useCallback((): void => {
    if (busyRef.current) return;
    busyRef.current = true;
    setNotice(null);
    setActivity('restoring');
    void (async () => {
      try {
        const outcome = await restoreStorePurchases();
        if (outcome.kind === 'cancelled') {
          finish('restore', null);
          return;
        }
        if (outcome.kind === 'failed') {
          warnHaptic();
          finish('restore', { tone: 'bad', message: storeFailureLine(outcome.reason) });
          return;
        }
        if (outcome.kind === 'none') {
          finish('restore', {
            tone: 'quiet',
            message: 'There is no membership to restore on this store account.',
          });
          return;
        }
        const restoredTier = tierForEntitlements(outcome.entitlements);
        if (aliveRef.current) setActivity('confirming');
        const confirmed = restoredTier !== null && (await confirmWithServer(restoredTier));
        if (confirmed && aliveRef.current) successHaptic();
        finish('restore', restoredLine(restoredTier, confirmed));
      } finally {
        busyRef.current = false;
      }
    })();
  }, [finish]);

  const reset = useCallback((): void => {
    setNotice(null);
  }, []);

  return {
    loading,
    available: billingIsLive && sellableTiers(packages).length > 0,
    canBuy,
    packagesFor,
    activity,
    notice,
    storeLabel: storeName(),
    buy,
    restore,
    reset,
  };
}
