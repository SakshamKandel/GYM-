import {
  accountProfiles,
  accounts,
  admins,
  awardedBadges,
  buddyActivity,
  buddyLinks,
  buddyQuestAwards,
  buddySessionParticipants,
  buddySessions,
  challengeMembers,
  checkIns,
  coachApplications,
  coachAssignments,
  coachChallenges,
  coachMessages,
  coachMilestones,
  coachPayoutRequests,
  coachPicks,
  coachProfiles,
  coachRequests,
  coachTierRequests,
  devicePushTokens,
  discountGrants,
  foods,
  gamificationProfiles,
  mealOrders,
  mealPartners,
  mealPaymentRequests,
  mealSubscriptions,
  paymentRequests,
  profiles,
  progressPhotos,
  progressionSuggestions,
  promoRedemptions,
  referrals,
  restShieldUses,
  sessions,
  syncedSets,
  syncedWorkouts,
  trialUsage,
  type Db,
  walletLedger,
  workoutFlagAcks,
  xpEvents,
} from '@gym/db';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  accountDeletionConfirmationMatches,
  buildAccountDeletionImpact,
  TERMINAL_ORDER_STATUSES,
  type AccountDeletionCounts,
  type AccountDeletionImpact,
} from '@gym/shared';
import { and, count, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { logAudit } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { getImageProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

const deleteBodySchema = z
  .object({ confirmation: z.string().max(20) })
  .strict();

function firstCount(rows: readonly { value: number }[]): number {
  return rows[0]?.value ?? 0;
}

interface DeletionContext {
  impact: AccountDeletionImpact;
  legacyProfileId: string | null;
}

/** Load every operational/offboarding/retention dependency in one DB batch. */
async function loadDeletionContext(
  db: Db,
  uid: string,
  email: string,
): Promise<DeletionContext> {
  const legacyProfiles = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`lower(${profiles.email}) = ${email.toLowerCase()}`)
    .limit(2);

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
      .where(
        and(eq(paymentRequests.accountId, uid), eq(paymentRequests.status, 'pending')),
      ),
    db.select({ value: count() }).from(admins).where(eq(admins.accountId, uid)),
    db
      .select({ value: count() })
      .from(mealPartners)
      .where(eq(mealPartners.accountId, uid)),
    db
      .select({ value: count() })
      .from(coachProfiles)
      .where(eq(coachProfiles.accountId, uid)),
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
    db
      .select({ value: count() })
      .from(paymentRequests)
      .where(eq(paymentRequests.accountId, uid)),
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
    db
      .select({ value: count() })
      .from(walletLedger)
      .where(eq(walletLedger.coachId, uid)),
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

function pgErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const value = (error as { code?: unknown }).code;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);

  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  return json({ user }, 200);
}

/**
 * DELETE /api/me — confirmed, fail-closed self-service account erasure.
 *
 * Hard deletion is allowed only when it cannot cascade operational or retained
 * commerce/financial records. Those records currently have non-null account
 * FKs; deleting them would corrupt the audit trail, while retaining an ad-hoc
 * account tombstone would leave unrelated PII reachable. Until a dedicated
 * deleted-subject/tombstone migration ships, affected accounts receive a
 * stable 409 impact object for support-assisted offboarding/anonymization.
 *
 * Eligible accounts are erased atomically. One exact legacy-profile email
 * match is erased in that batch; multiple matches fail closed as ambiguous.
 * Private progress-image destruction happens first and is idempotent, while DB
 * references remain on provider failure, making the entire request retry-safe.
 */
export async function DELETE(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsedBody = deleteBodySchema.safeParse(await readJson(req));
  if (
    !parsedBody.success ||
    !accountDeletionConfirmationMatches(parsedBody.data.confirmation)
  ) {
    return json(
      {
        error: 'confirmation_required',
        expected: ACCOUNT_DELETION_CONFIRMATION,
      },
      400,
    );
  }

  const uid = user.id;
  const db = getDb();
  const context = await loadDeletionContext(db, uid, user.email);
  if (!context.impact.canDelete) {
    return json({ error: 'account_deletion_blocked', impact: context.impact }, 409);
  }

  const privatePhotos = await db
    .select({ id: progressPhotos.id, uid: progressPhotos.imageUrl })
    .from(progressPhotos)
    .where(eq(progressPhotos.accountId, uid));

  if (privatePhotos.length > 0) {
    const provider = getImageProvider();
    const results = await Promise.allSettled(
      privatePhotos.map((photo) => provider.deleteImage(photo.uid, 'authenticated')),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      const notConfigured = failures.some(
        (result) =>
          result.status === 'rejected' && result.reason instanceof NotConfiguredError,
      );
      console.error('Account deletion progress-photo cleanup incomplete', {
        accountId: uid,
        attempted: privatePhotos.length,
        failed: failures.length,
      });
      return json(
        {
          error: 'private_asset_cleanup_pending',
          cleanup: {
            kind: 'progress_photos',
            remaining: failures.length,
            retrySafe: true,
          },
        },
        notConfigured ? 503 : 502,
      );
    }
  }

  // Do not copy email/PII into the retained audit row.
  await logAudit({ id: uid }, 'account.delete', 'account', uid, {
    self: true,
    confirmation: 'typed',
  });

  // Subqueries for grandchildren rows keyed to my parents (not to my account).
  const myWorkoutIds = db
    .select({ id: syncedWorkouts.id })
    .from(syncedWorkouts)
    .where(eq(syncedWorkouts.accountId, uid));
  const myChallengeIds = db
    .select({ id: coachChallenges.id })
    .from(coachChallenges)
    .where(eq(coachChallenges.coachId, uid));
  const myHostedSessionIds = db
    .select({ id: buddySessions.id })
    .from(buddySessions)
    .where(eq(buddySessions.hostId, uid));

  // A legacy custom food can reference profiles.created_by without a cascade;
  // detach that attribution before deleting the one verified legacy profile.
  const legacyProfileId =
    context.legacyProfileId ?? `__no_matching_legacy_profile__:${uid}`;

  // FK-safe order: leaves → parents → the account row. Executed atomically.
  try {
    await db.batch([
    db
      .delete(workoutFlagAcks)
      .where(
        or(eq(workoutFlagAcks.coachId, uid), inArray(workoutFlagAcks.workoutId, myWorkoutIds)),
      ),
    db.delete(syncedSets).where(eq(syncedSets.accountId, uid)),
    db.delete(progressionSuggestions).where(eq(progressionSuggestions.accountId, uid)),
    // check_ins reference coach_messages (coach_reply_message_id) → delete first.
    db.delete(checkIns).where(eq(checkIns.accountId, uid)),
    db.delete(coachMessages).where(eq(coachMessages.accountId, uid)),
    db.delete(syncedWorkouts).where(eq(syncedWorkouts.accountId, uid)),
    db.delete(xpEvents).where(eq(xpEvents.accountId, uid)),
    db.delete(awardedBadges).where(eq(awardedBadges.accountId, uid)),
    db.delete(gamificationProfiles).where(eq(gamificationProfiles.accountId, uid)),
    db.delete(restShieldUses).where(eq(restShieldUses.accountId, uid)),
    db
      .delete(challengeMembers)
      .where(
        or(eq(challengeMembers.accountId, uid), inArray(challengeMembers.challengeId, myChallengeIds)),
      ),
    db.delete(coachChallenges).where(eq(coachChallenges.coachId, uid)),
    db.delete(coachPicks).where(or(eq(coachPicks.coachId, uid), eq(coachPicks.accountId, uid))),
    db
      .delete(buddyQuestAwards)
      .where(or(eq(buddyQuestAwards.accountA, uid), eq(buddyQuestAwards.accountB, uid))),
    db
      .delete(buddySessionParticipants)
      .where(
        or(
          eq(buddySessionParticipants.accountId, uid),
          inArray(buddySessionParticipants.sessionId, myHostedSessionIds),
        ),
      ),
    db.delete(buddySessions).where(eq(buddySessions.hostId, uid)),
    db
      .delete(buddyActivity)
      .where(or(eq(buddyActivity.accountId, uid), eq(buddyActivity.targetId, uid))),
    db
      .delete(buddyLinks)
      .where(or(eq(buddyLinks.requesterId, uid), eq(buddyLinks.addresseeId, uid))),
    db.delete(referrals).where(or(eq(referrals.referrerId, uid), eq(referrals.inviteeId, uid))),
    db.delete(trialUsage).where(eq(trialUsage.accountId, uid)),
    db.delete(devicePushTokens).where(eq(devicePushTokens.accountId, uid)),
    // Mentorship rows on BOTH sides: mine as the member AND (if I was a coach)
    // rows where I am the coach on someone else's data.
    db
      .delete(coachMilestones)
      .where(or(eq(coachMilestones.accountId, uid), eq(coachMilestones.coachId, uid))),
    db
      .delete(coachRequests)
      .where(or(eq(coachRequests.userId, uid), eq(coachRequests.coachId, uid))),
    db
      .delete(coachAssignments)
      .where(
        or(
          eq(coachAssignments.coachId, uid),
          eq(coachAssignments.userId, uid),
          eq(coachAssignments.assignedBy, uid),
        ),
      ),
    db.delete(coachProfiles).where(eq(coachProfiles.accountId, uid)),
    db.delete(admins).where(eq(admins.accountId, uid)),
    db.delete(accountProfiles).where(eq(accountProfiles.accountId, uid)),
    db.delete(progressPhotos).where(eq(progressPhotos.accountId, uid)),
    db.update(foods).set({ createdBy: null }).where(eq(foods.createdBy, legacyProfileId)),
    db
      .delete(profiles)
      .where(
        and(
          eq(profiles.id, legacyProfileId),
          sql`lower(${profiles.email}) = ${user.email.toLowerCase()}`,
        ),
      ),
    db.delete(sessions).where(eq(sessions.accountId, uid)),
    db.delete(accounts).where(eq(accounts.id, uid)),
    ]);
  } catch (error) {
    // A retained-history dependency can appear after the impact read. Reload
    // and return the same stable response instead of leaking a raw FK error.
    // Cloudinary deletion is idempotent, so already-removed images are safe on
    // the next attempt while this atomic DB batch has rolled back.
    if (pgErrorCode(error) === '23503') {
      const racedContext = await loadDeletionContext(db, uid, user.email);
      if (!racedContext.impact.canDelete) {
        return json(
          { error: 'account_deletion_blocked', impact: racedContext.impact },
          409,
        );
      }
      return json({ error: 'account_deletion_conflict', retryable: true }, 409);
    }
    throw error;
  }

  return json({ ok: true }, 200);
}
