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
  coachAssignments,
  coachChallenges,
  coachMessages,
  coachMilestones,
  coachPicks,
  coachProfiles,
  coachRequests,
  devicePushTokens,
  foods,
  gamificationProfiles,
  passwordResetTokens,
  profiles,
  progressPhotos,
  progressionSuggestions,
  referrals,
  restShieldUses,
  sessions,
  syncedSets,
  syncedWorkouts,
  trialUsage,
  workoutFlagAcks,
  xpEvents,
} from '@gym/db';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminRoleOf,
  logAudit,
  requireOutranks,
  requirePermission,
} from '@/lib/authz';
import {
  loadAccountDeletionContext,
  pgErrorCode,
  purgeAccountProgressPhotos,
  scrubAccountAuditHistory,
} from '@/lib/accountDeletionDb';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * POST /api/admin/members/[id]/gdpr — staff-issued hard account deletion.
 *
 * Authorization stays stricter than self-service: credential-management
 * permission, rank protection, cannot-target-self, and an exact typed-email
 * confirmation. The destructive policy itself is identical to DELETE /api/me:
 * active services, offboarding dependencies, ambiguous legacy identity, or any
 * retained commerce/financial history return the same typed 409 impact object.
 *
 * This endpoint does not claim to anonymize retained records. It only performs
 * a hard delete when the shared policy proves that doing so cannot destroy them.
 * Private progress images and one unambiguous legacy profile are cleaned with
 * the same retry-safe sequence as self-service deletion.
 */

const bodySchema = z.object({
  confirm: z.string(),
  reason: z.string().max(500).optional(),
});

function getIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(req, 'members.manage_credentials');
  if (actor instanceof Response) return actor;

  const { id } = await ctx.params;

  // Self-erasure belongs to DELETE /api/me — never here.
  if (id === actor.id) return json({ error: 'cannot_target_self' }, 400);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { confirm, reason } = parsed.data;

  const db = getDb();
  const ip = getIp(req);

  // Rank guard before existence lookup: a lower-ranked staffer gets the same
  // rejection for real and made-up staff ids alike.
  const targetRole = await adminRoleOf(id);
  const rankBlock = requireOutranks(actor, targetRole);
  if (rankBlock) return rankBlock;

  const rows = await db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  const account = rows[0];
  if (!account) return json({ error: 'not_found' }, 404);

  // Typed-confirm: the admin must echo the exact email (case-insensitive) to
  // arm this irreversible cascade.
  if (confirm.trim().toLowerCase() !== account.email.toLowerCase()) {
    return json({ error: 'confirm_mismatch' }, 400);
  }

  const deletionContext = await loadAccountDeletionContext(db, id, account.email);
  if (!deletionContext.impact.canDelete) {
    return json(
      { error: 'account_deletion_blocked', impact: deletionContext.impact },
      409,
    );
  }

  const photoCleanup = await purgeAccountProgressPhotos(db, id);
  if (!photoCleanup.ok) return json(photoCleanup.body, photoCleanup.status);

  // Audit the hard-delete attempt without copying the member email into the
  // retained audit metadata. If the atomic batch fails, this remains an attempt
  // record; it never claims that retained history was anonymized.
  await logAudit(
    actor,
    'member.account_delete',
    'account',
    id,
    { reason, self: false, confirmation: 'typed_email' },
    ip,
  );

  const uid = id;
  const legacyProfileId =
    deletionContext.legacyProfileId ?? `__no_matching_legacy_profile__:${uid}`;

  // Subqueries for grandchildren rows keyed to this account's parents.
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

  // FK-safe order: leaves → parents → the account row. Executed atomically.
  // Mirrors DELETE /api/me exactly, plus the admin-issued reset tokens that the
  // self-serve path never mints (FK'd ON DELETE CASCADE, so the final accounts
  // delete would clear them anyway — deleted explicitly here for clarity).
  //
  // Defensive 23503 map: a retained/offboarding dependency can appear after
  // the shared impact read. Reload the canonical impact instead of surfacing a
  // raw FK error; already-destroyed Cloudinary assets remain retry-safe.
  try {
    await db.batch([
    db
      .delete(workoutFlagAcks)
      .where(
        or(eq(workoutFlagAcks.coachId, uid), inArray(workoutFlagAcks.workoutId, myWorkoutIds)),
      ),
    db.delete(syncedSets).where(eq(syncedSets.accountId, uid)),
    db.delete(progressionSuggestions).where(eq(progressionSuggestions.accountId, uid)),
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
    db.delete(passwordResetTokens).where(eq(passwordResetTokens.accountId, uid)),
    db.delete(coachProfiles).where(eq(coachProfiles.accountId, uid)),
    db.delete(admins).where(eq(admins.accountId, uid)),
    db.delete(accountProfiles).where(eq(accountProfiles.accountId, uid)),
    db.delete(progressPhotos).where(eq(progressPhotos.accountId, uid)),
    scrubAccountAuditHistory(db, uid, account.email),
    db.update(foods).set({ createdBy: null }).where(eq(foods.createdBy, legacyProfileId)),
    db
      .delete(profiles)
      .where(
        and(
          eq(profiles.id, legacyProfileId),
          sql`lower(${profiles.email}) = ${account.email.toLowerCase()}`,
        ),
      ),
    db.delete(sessions).where(eq(sessions.accountId, uid)),
    db.delete(accounts).where(eq(accounts.id, uid)),
    ]);
  } catch (err) {
    if (pgErrorCode(err) === '23503') {
      const racedContext = await loadAccountDeletionContext(db, uid, account.email);
      if (!racedContext.impact.canDelete) {
        return json(
          { error: 'account_deletion_blocked', impact: racedContext.impact },
          409,
        );
      }
      return json({ error: 'account_deletion_conflict', retryable: true }, 409);
    }
    throw err;
  }

  return json({ ok: true }, 200);
}
