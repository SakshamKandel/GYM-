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
  coachPicks,
  coachProfiles,
  devicePushTokens,
  gamificationProfiles,
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
import { eq, inArray, or } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { logAudit } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

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
 * DELETE /api/me — hard-delete the signed-in account and every row it owns
 * (App Store account-deletion requirement).
 *
 * The deletion is one atomic db.batch() (neon-http runs a batch inside a
 * single transaction — the driver has no interactive transactions), with
 * children deleted before parents so it holds even if an FK were missing its
 * ON DELETE action. Rows that merely REFERENCE this account on someone else's
 * data (audit_log.actor_id, plan_videos.created_by, coach_messages.sender_
 * account_id, awarded_badges.verified_by, progression_suggestions.coach_id)
 * are FK'd SET NULL and fire on the final accounts delete — history survives,
 * anonymized.
 *
 * Audited BEFORE deletion (actor = self); the audit row outlives the account
 * via audit_log's ON DELETE SET NULL.
 *
 * NOTE: the LEGACY profiles-keyed tables (workout_logs, set_logs, weight_logs,
 * food_logs, …, keyed on profiles.id — the pre-auth identity) have no linkage
 * to accounts.id and are not touched here.
 */
export async function DELETE(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const uid = user.id;

  // Audit FIRST — if the batch below fails, the attempt is still on record.
  await logAudit({ id: uid }, 'account.delete', 'account', uid, {
    email: user.email,
    self: true,
  });

  const db = getDb();

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

  // FK-safe order: leaves → parents → the account row. Executed atomically.
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
    db.delete(sessions).where(eq(sessions.accountId, uid)),
    db.delete(accounts).where(eq(accounts.id, uid)),
  ]);

  return json({ ok: true }, 200);
}
