import {
  admins,
  auditLog,
  coachApplications,
  coachAssignments,
  coachPayoutRequests,
  coachProfiles,
  coachRequests,
  coachTierRequests,
  discountGrants,
  mealOrders,
  mealPartners,
  mealPaymentRequests,
  mealSubscriptions,
  paymentRequests,
  profiles,
  progressPhotos,
  promoRedemptions,
  type Db,
  walletLedger,
} from '@gym/db';
import {
  buildAccountDeletionImpact,
  TERMINAL_ORDER_STATUSES,
  type AccountDeletionCounts,
  type AccountDeletionImpact,
} from '@gym/shared';
import { and, count, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { getImageProvider, NotConfiguredError } from './video';

function firstCount(rows: readonly { value: number }[]): number {
  return rows[0]?.value ?? 0;
}

export interface AccountDeletionContext {
  impact: AccountDeletionImpact;
  legacyProfileId: string | null;
}

/**
 * Canonical dependency loader for both self-service and staff-issued account
 * deletion. Any new operational or retained-history relation belongs here so
 * the two destructive routes cannot drift apart.
 */
export async function loadAccountDeletionContext(
  db: Db,
  uid: string,
  email: string,
): Promise<AccountDeletionContext> {
  const legacyProfiles = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`lower(${profiles.email}) = ${email.toLowerCase()}`);

  const [
    liveOrders,
    openSubscriptions,
    pendingMealPayments,
    pendingMembershipPayments,
    staffRoles,
    partnerProfiles,
    coachProfileRows,
    activeCoachAssignments,
    pendingCoachRequests,
    pendingCoachApplications,
    pendingCoachTierRequests,
    pendingCoachPayouts,
    allMealOrders,
    allMealSubscriptions,
    allMealPayments,
    allMembershipPayments,
    allPromoRedemptions,
    allDiscountGrants,
    allCoachPayouts,
    allWalletEntries,
  ] = await db.batch([
    db
      .select({ value: count() })
      .from(mealOrders)
      .where(
        and(
          eq(mealOrders.accountId, uid),
          notInArray(mealOrders.status, [...TERMINAL_ORDER_STATUSES]),
        ),
      ),
    db
      .select({ value: count() })
      .from(mealSubscriptions)
      .where(
        and(
          eq(mealSubscriptions.accountId, uid),
          inArray(mealSubscriptions.status, ['active', 'paused']),
        ),
      ),
    db
      .select({ value: count() })
      .from(mealPaymentRequests)
      .where(
        and(
          eq(mealPaymentRequests.accountId, uid),
          eq(mealPaymentRequests.status, 'pending'),
        ),
      ),
    db
      .select({ value: count() })
      .from(paymentRequests)
      .where(and(eq(paymentRequests.accountId, uid), eq(paymentRequests.status, 'pending'))),
    db.select({ value: count() }).from(admins).where(eq(admins.accountId, uid)),
    db.select({ value: count() }).from(mealPartners).where(eq(mealPartners.accountId, uid)),
    db.select({ value: count() }).from(coachProfiles).where(eq(coachProfiles.accountId, uid)),
    db
      .select({ value: count() })
      .from(coachAssignments)
      .where(
        and(
          eq(coachAssignments.status, 'active'),
          or(eq(coachAssignments.coachId, uid), eq(coachAssignments.userId, uid)),
        ),
      ),
    db
      .select({ value: count() })
      .from(coachRequests)
      .where(
        and(
          eq(coachRequests.status, 'pending'),
          or(eq(coachRequests.coachId, uid), eq(coachRequests.userId, uid)),
        ),
      ),
    db
      .select({ value: count() })
      .from(coachApplications)
      .where(
        and(
          eq(coachApplications.accountId, uid),
          eq(coachApplications.status, 'pending'),
        ),
      ),
    db
      .select({ value: count() })
      .from(coachTierRequests)
      .where(
        and(eq(coachTierRequests.coachId, uid), eq(coachTierRequests.status, 'pending')),
      ),
    db
      .select({ value: count() })
      .from(coachPayoutRequests)
      .where(
        and(eq(coachPayoutRequests.coachId, uid), eq(coachPayoutRequests.status, 'pending')),
      ),
    db.select({ value: count() }).from(mealOrders).where(eq(mealOrders.accountId, uid)),
    db
      .select({ value: count() })
      .from(mealSubscriptions)
      .where(eq(mealSubscriptions.accountId, uid)),
    db
      .select({ value: count() })
      .from(mealPaymentRequests)
      .where(eq(mealPaymentRequests.accountId, uid)),
    db.select({ value: count() }).from(paymentRequests).where(eq(paymentRequests.accountId, uid)),
    db
      .select({ value: count() })
      .from(promoRedemptions)
      .where(eq(promoRedemptions.accountId, uid)),
    db
      .select({ value: count() })
      .from(discountGrants)
      .where(eq(discountGrants.accountId, uid)),
    db
      .select({ value: count() })
      .from(coachPayoutRequests)
      .where(eq(coachPayoutRequests.coachId, uid)),
    db.select({ value: count() }).from(walletLedger).where(eq(walletLedger.coachId, uid)),
  ]);

  const counts: AccountDeletionCounts = {
    liveMealOrders: firstCount(liveOrders),
    openMealSubscriptions: firstCount(openSubscriptions),
    pendingMealPaymentRequests: firstCount(pendingMealPayments),
    pendingMembershipPaymentRequests: firstCount(pendingMembershipPayments),
    staffRoles: firstCount(staffRoles),
    partnerProfiles: firstCount(partnerProfiles),
    coachProfiles: firstCount(coachProfileRows),
    activeCoachAssignments: firstCount(activeCoachAssignments),
    pendingCoachRequests: firstCount(pendingCoachRequests),
    pendingCoachApplications: firstCount(pendingCoachApplications),
    pendingCoachTierRequests: firstCount(pendingCoachTierRequests),
    pendingCoachPayoutRequests: firstCount(pendingCoachPayouts),
    matchingLegacyProfiles: legacyProfiles.length,
    mealOrders: firstCount(allMealOrders),
    mealSubscriptions: firstCount(allMealSubscriptions),
    mealPaymentRequests: firstCount(allMealPayments),
    membershipPaymentRequests: firstCount(allMembershipPayments),
    promoRedemptions: firstCount(allPromoRedemptions),
    discountGrants: firstCount(allDiscountGrants),
    coachPayoutRequests: firstCount(allCoachPayouts),
    walletLedgerEntries: firstCount(allWalletEntries),
  };

  return {
    impact: buildAccountDeletionImpact(counts),
    legacyProfileId: legacyProfiles.length === 1 ? legacyProfiles[0]?.id ?? null : null,
  };
}

export interface PrivateAssetCleanupFailure {
  ok: false;
  status: 502 | 503;
  body: {
    error: 'private_asset_cleanup_pending';
    cleanup: {
      kind: 'progress_photos';
      remaining: number;
      retrySafe: true;
    };
  };
}

/**
 * Keep an audit action/timestamp while removing identifiers and free-form
 * metadata tied to the deleted subject. Matching both the stable account ID
 * and email catches older audit writers that embedded either value in JSON.
 */
export function scrubAccountAuditHistory(db: Db, accountId: string, email: string) {
  return db
    .update(auditLog)
    .set({ targetId: null, meta: { erased: true }, ip: null })
    .where(
      or(
        eq(auditLog.actorId, accountId),
        eq(auditLog.targetId, accountId),
        sql`strpos(coalesce(${auditLog.meta}::text, ''), ${accountId}) > 0`,
        sql`strpos(lower(coalesce(${auditLog.meta}::text, '')), ${email.toLowerCase()}) > 0`,
      ),
    );
}

/**
 * Destroy all authenticated progress-photo assets without removing DB rows.
 * Every asset is attempted; any failure aborts account deletion. Successful
 * destroys are retry-safe because provider deletion treats missing as a no-op.
 */
export async function purgeAccountProgressPhotos(
  db: Db,
  accountId: string,
): Promise<{ ok: true } | PrivateAssetCleanupFailure> {
  const privatePhotos = await db
    .select({ uid: progressPhotos.imageUrl })
    .from(progressPhotos)
    .where(eq(progressPhotos.accountId, accountId));
  if (privatePhotos.length === 0) return { ok: true };

  const provider = getImageProvider();
  const results = await Promise.allSettled(
    privatePhotos.map((photo) => provider.deleteImage(photo.uid, 'authenticated')),
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length === 0) return { ok: true };

  const notConfigured = failures.some(
    (result) =>
      result.status === 'rejected' && result.reason instanceof NotConfiguredError,
  );
  console.error('Account deletion progress-photo cleanup incomplete', {
    accountId,
    attempted: privatePhotos.length,
    failed: failures.length,
  });
  return {
    ok: false,
    status: notConfigured ? 503 : 502,
    body: {
      error: 'private_asset_cleanup_pending',
      cleanup: {
        kind: 'progress_photos',
        remaining: failures.length,
        retrySafe: true,
      },
    },
  };
}

/** Postgres/driver error shape carrying a SQLSTATE code, when present. */
export function pgErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const value = (error as { code?: unknown }).code;
    return typeof value === 'string' ? value : null;
  }
  return null;
}
