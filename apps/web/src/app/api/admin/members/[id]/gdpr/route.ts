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
  gamificationProfiles,
  passwordResetTokens,
  progressionSuggestions,
  referrals,
  restShieldUses,
  sessions,
  syncedSets,
  syncedWorkouts,
  trialUsage,
  walletLedger,
  workoutFlagAcks,
  xpEvents,
} from '@gym/db';
import { eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminRoleOf,
  logAudit,
  requireOutranks,
  requirePermission,
} from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * POST /api/admin/members/[id]/gdpr — admin-initiated GDPR erasure (P1-7, gated
 * `members.manage_credentials`).
 *
 * This runs the EXACT cascade the self-serve DELETE /api/me performs (children
 * before parents, one atomic db.batch — neon-http has no interactive
 * transactions), so history that merely REFERENCES this account on someone
 * else's data (audit_log.actor_id, plan_videos.created_by, coach_messages
 * sender, awarded_badges.verified_by, progression_suggestions.coach_id) is FK
 * SET NULL — it survives, anonymized. The only difference from the self-serve
 * route is the actor: here a staffer erases someone else's account.
 *
 * ONE reference is deliberately NOT nullable: `wallet_ledger.coach_id` is a FK
 * with `onDelete: 'restrict'` — money history must never vanish with an account
 * row, so a coach who ever earned a commission / took a payout / received a
 * wallet adjustment can only be SUSPENDED, not hard-deleted. We fail-fast on
 * such accounts with `coach_has_wallet_ledger` BEFORE writing the audit row or
 * opening the batch, so the audit log never records a completed erasure that
 * Postgres would then roll back on the RESTRICT violation. A defensive
 * 23503 → 409 map around the batch covers the narrow race where a ledger row is
 * written between the pre-check and the delete.
 *
 * Guards:
 *  - `cannot_target_self`: an admin must erase their OWN account through
 *    DELETE /api/me (self-erasing here would kill the console mid-batch and,
 *    for the sole super_admin, be an unrecoverable lockout).
 *  - `requireOutranks`: a lower-ranked staffer cannot erase a peer/higher admin.
 *  - typed confirm: the request body must echo the exact account email, so an
 *    irreversible wipe can never fire on a stray click / wrong drawer.
 *  - `coach_has_wallet_ledger`: an account with wallet_ledger history cannot be
 *    erased (suspend-only, per the RESTRICT FK); returned as 409.
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

/** Postgres/driver error shape carrying a SQLSTATE code, when present. */
function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
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

  // Money-history guard, BEFORE the audit write. wallet_ledger.coach_id FK's
  // accounts.id with ON DELETE 'restrict' (money history must never vanish with
  // an account row — coaches with ledger entries can only be SUSPENDED, not
  // hard-deleted). If this account has any ledger row, the terminal
  // `db.delete(accounts)` below would throw the restrict violation, and since
  // neon-http runs the whole db.batch as ONE transaction, the entire erasure
  // rolls back. Reject explicitly here so the caller gets an actionable error
  // instead of a raw 500 — and, critically, so we never write a
  // `member.gdpr_anonymize` audit row claiming an erasure that never happened.
  const ledgerRows = await db
    .select({ id: walletLedger.id })
    .from(walletLedger)
    .where(eq(walletLedger.coachId, id))
    .limit(1);
  if (ledgerRows.length > 0) {
    return json({ error: 'coach_has_wallet_ledger' }, 409);
  }

  // Audit FIRST (actor = staff) — if the batch below fails, the attempt is
  // still on record. The audit row outlives the account via audit_log's ON
  // DELETE SET NULL on actor_id/target_id.
  await logAudit(
    actor,
    'member.gdpr_anonymize',
    'account',
    id,
    { email: account.email, reason, self: false },
    ip,
  );

  const uid = id;

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
  // Defensive 23503 map: the pre-check above rejects accounts that already hold
  // wallet_ledger rows, but a commission credit could land in the narrow window
  // between that check and this batch. Rather than let a RESTRICT violation
  // surface as a raw 500, map it back to the same actionable 409.
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
    db.delete(sessions).where(eq(sessions.accountId, uid)),
    db.delete(accounts).where(eq(accounts.id, uid)),
    ]);
  } catch (err) {
    if (pgErrorCode(err) === '23503') {
      return json({ error: 'coach_has_wallet_ledger' }, 409);
    }
    throw err;
  }

  return json({ ok: true }, 200);
}
