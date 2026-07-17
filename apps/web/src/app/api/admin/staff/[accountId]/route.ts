import { admins, sessions } from '@gym/db';
import { eq } from 'drizzle-orm';
import { adminRoleOf, logAudit, requirePermission, requireOutranks } from '@/lib/authz';
import { coachOffboardCounts, offboardCoach } from '@/lib/coachOffboard';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — revoke a staff role.
 *
 *  - DELETE?dryRun=1 → READ-ONLY pre-flight: returns { dryRun: true, targetRole,
 *             counts } describing the offboarding blast radius (active clients,
 *             pending requests, plans, outstanding wallet balance) so the
 *             console can require a typed confirm with real numbers (P0-3). No
 *             mutation. Still rank/self-guarded so it can't be used as an oracle
 *             the actor couldn't otherwise act on.
 *  - DELETE → removes the account's `admins` row (revoking all staff access) AND
 *             deletes every one of that account's `sessions`, so any live token
 *             (console cookie or mobile Bearer) dies instantly instead of
 *             lingering until expiry. When the revoked role is `coach`, runs the
 *             offboarding cascade FIRST (C2): end active assignments, decline
 *             pending requests, deactivate the coach profile, archive assigned
 *             plans — money/ledger is preserved. 404 if the account was not staff.
 *
 * Guarded by requirePermission('roles.grant') — super_admin + main_admin —
 * plus a RANK check (requireOutranks): the actor must outrank the target's
 * CURRENT role, so a main_admin can revoke sub-roles only; main_admin and
 * super_admin rows are super_admin's to manage. Audited. Nobody can revoke
 * their OWN role here (self-lockout guard); another, higher/equal-ranked
 * super_admin must do it.
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const principal = await requirePermission(req, 'roles.grant');
  if (principal instanceof Response) return principal;

  const { accountId } = await params;
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1';

  // Self-lockout guard: refuse to strip the caller's own staff access, which
  // would immediately kill their session and lock them out of the console.
  if (accountId === principal.id) {
    return json({ error: 'cannot_revoke_self' }, 400);
  }

  const db = getDb();

  // Rank check BEFORE the delete: the actor must outrank the target's current
  // role (main_admin → sub-roles only; super_admin → anyone).
  const targetRole = await adminRoleOf(accountId);
  if (targetRole === null) {
    return json({ error: 'not_staff' }, 404);
  }
  const rankBlock = requireOutranks(principal, targetRole);
  if (rankBlock) return rankBlock;

  // Dry-run: surface the offboarding blast radius without touching anything.
  if (dryRun) {
    const counts = targetRole === 'coach' ? await coachOffboardCounts(db, accountId) : null;
    return json({ dryRun: true, targetRole, counts }, 200);
  }

  const ip = req.headers.get('x-forwarded-for');

  // Coach offboarding cascade FIRST (C2) — end assignments, decline requests,
  // deactivate profile, archive plans — so revoking never orphans clients.
  let cascade: Awaited<ReturnType<typeof offboardCoach>> | null = null;
  if (targetRole === 'coach') {
    cascade = await offboardCoach(db, accountId);
    await logAudit(
      principal,
      'coach.offboard',
      'account',
      accountId,
      {
        reason: 'role_revoked',
        activeClients: cascade.activeClients,
        pendingRequests: cascade.pendingRequests,
        activeWorkoutPlans: cascade.activeWorkoutPlans,
        activeDietPlans: cascade.activeDietPlans,
        walletBalances: cascade.walletBalances,
        endedClientIds: cascade.endedClientIds,
      },
      ip,
    );
  }

  const deleted = await db
    .delete(admins)
    .where(eq(admins.accountId, accountId))
    .returning({ accountId: admins.accountId, role: admins.role });

  if (deleted.length === 0) {
    return json({ error: 'not_staff' }, 404);
  }

  // Kill every live session for this account so revoked access takes effect now.
  await db.delete(sessions).where(eq(sessions.accountId, accountId));

  await logAudit(
    principal,
    'roles.revoke',
    'account',
    accountId,
    { role: deleted[0].role },
    ip,
  );

  return json({ ok: true, cascade }, 200);
}
