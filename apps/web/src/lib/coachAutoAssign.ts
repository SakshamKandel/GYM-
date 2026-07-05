import { accounts, admins, coachAssignments } from '@gym/db';
import { and, asc, eq } from 'drizzle-orm';
import { type Principal, logAudit } from './authz';
import { getDb } from './db';

/**
 * Elite → coach (Greece) auto-assignment.
 *
 * When a member's EFFECTIVE tier reaches 'elite', we ensure an ACTIVE
 * coach_assignments row links them to the coach. When their effective tier
 * drops below elite (expiry or downgrade), we END that auto-created row — but
 * ONLY if it points at the resolved auto-coach; a manual assignment to a
 * DIFFERENT coach is left completely untouched.
 *
 * Idempotent by design: it respects UNIQUE(coach_id,user_id) by reactivating an
 * 'ended' row (onConflictDoUpdate) rather than insert-crashing. Both directions
 * audit ('coach.assign' / 'coach.unassign', meta.auto = true).
 *
 * Coach resolution (deterministic + documented):
 *   1. COACH_GREECE_EMAIL env (case-insensitive, lowercased) if it maps to an
 *      account holding admins.role='coach'.
 *   2. else the OLDEST admins.role='coach' account (accounts.createdAt asc),
 *      which in this deployment is Greece (greecemaharjan@gmail.com, seeded
 *      first — DEPLOY.md §3).
 *   3. If no coach exists, this is a no-op (nothing to assign to).
 */

/** Resolve the auto-assign coach's account id, or null when none exists. */
export async function resolveAutoCoachId(): Promise<string | null> {
  const db = getDb();

  const configured = process.env.COACH_GREECE_EMAIL?.trim().toLowerCase();
  if (configured) {
    const byEmail = await db
      .select({ accountId: admins.accountId })
      .from(admins)
      .innerJoin(accounts, eq(accounts.id, admins.accountId))
      .where(and(eq(admins.role, 'coach'), eq(accounts.email, configured)))
      .limit(1);
    if (byEmail[0]) return byEmail[0].accountId;
    // Configured email isn't a coach → fall through to the deterministic default.
  }

  const oldest = await db
    .select({ accountId: admins.accountId })
    .from(admins)
    .innerJoin(accounts, eq(accounts.id, admins.accountId))
    .where(eq(admins.role, 'coach'))
    .orderBy(asc(accounts.createdAt))
    .limit(1);
  return oldest[0]?.accountId ?? null;
}

/**
 * Reconcile the auto-assignment for `userId` against their new effective tier.
 * `effectiveTier` is the tier ACTUALLY in force (post-expiry), not the stored
 * one. Never throws — a sync failure must not fail the surrounding tier write.
 */
export async function syncEliteCoachAssignment(
  userId: string,
  effectiveTier: 'starter' | 'silver' | 'gold' | 'elite',
  actor: Principal | null,
): Promise<void> {
  try {
    const coachId = await resolveAutoCoachId();
    if (!coachId) return; // no coach configured — nothing to do

    // A member is never their own coach (e.g. Greece hitting elite herself).
    if (coachId === userId) return;

    const db = getDb();
    // assignedBy is a NOT NULL FK → accounts.id. Every current setAccountTier
    // caller passes a staff Principal (a real account). When actor is null
    // (defensive / future system-initiated path) we stamp the coach's own
    // account id so the FK always holds.
    const assignedBy = actor?.id ?? coachId;

    if (effectiveTier === 'elite') {
      // Ensure an ACTIVE row. Reactivate an 'ended' pair rather than crash on
      // the unique (coach,user) index.
      await db
        .insert(coachAssignments)
        .values({ coachId, userId, status: 'active', assignedBy })
        .onConflictDoUpdate({
          target: [coachAssignments.coachId, coachAssignments.userId],
          set: { status: 'active', assignedBy },
        });
      await logAudit(actor, 'coach.assign', 'account', userId, {
        coachId,
        auto: true,
      });
      return;
    }

    // Below elite → end ONLY the auto-coach's active row. A manual assignment to
    // a DIFFERENT coach is not this coach's row, so it's left alone.
    const ended = await db
      .update(coachAssignments)
      .set({ status: 'ended' })
      .where(
        and(
          eq(coachAssignments.coachId, coachId),
          eq(coachAssignments.userId, userId),
          eq(coachAssignments.status, 'active'),
        ),
      )
      .returning({ id: coachAssignments.id });

    if (ended.length > 0) {
      await logAudit(actor, 'coach.unassign', 'account', userId, {
        coachId,
        auto: true,
      });
    }
  } catch {
    // Best-effort: swallow so the tier write always succeeds. The next tier
    // change (or a manual admin assignment) will reconcile.
  }
}
