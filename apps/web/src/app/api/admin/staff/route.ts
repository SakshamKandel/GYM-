import { accounts, admins, coachProfiles } from '@gym/db';
import { isStaffRole } from '@gym/shared';
import { asc, eq } from 'drizzle-orm';
import { adminRoleOf, logAudit, requirePermission, requireOutranks } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — staff & roles management. Lets a super_admin see every staff
 * account, grant a role to an existing account, and change an existing role,
 * so the owner never has to hand-write an INSERT into `admins` again.
 *
 *  - GET  → every account with an `admins` row (email, displayName, role) joined
 *           to coach_profiles for the coach display name where present.
 *  - POST → grant or change a role for an existing account:
 *           { accountId, role }. Upserts the `admins` row (accountId is its PK,
 *           so a change is an ON CONFLICT DO UPDATE). When role='coach' it also
 *           upserts a coach_profiles row so the account immediately shows up in
 *           the coach roster / coach console.
 *
 * Both guarded by requirePermission('roles.grant') — super_admin + main_admin.
 * POST additionally enforces RANK (requireOutranks): the actor must be allowed
 * to manage BOTH the role being granted AND the target's current role, and may
 * never target their own row. Every mutation is audited. (Revoke lives in
 * [accountId]/route.ts as DELETE.)
 */

// Role-name validation now comes from @gym/shared (isStaffRole mirrors the
// admins.role enum, main_admin included). Anything outside the set is rejected
// 400 so a typo can never write a bogus role that the guard layer would then
// fail-closed on forever. WHO may assign WHICH role is a separate rank check
// (requireOutranks) — invalid name → 400, valid-but-outranking → 403.

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'roles.grant');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const rows = await db
    .select({
      accountId: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      status: accounts.status,
      role: admins.role,
      coachName: coachProfiles.displayName,
      createdAt: admins.createdAt,
    })
    .from(admins)
    .innerJoin(accounts, eq(accounts.id, admins.accountId))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .orderBy(asc(accounts.email));

  return json({ staff: rows }, 200);
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'roles.grant');
  if (principal instanceof Response) return principal;

  const body = await readJson(req);
  if (!body || typeof body !== 'object') {
    return json({ error: 'invalid_body' }, 400);
  }
  const { accountId, role } = body as { accountId?: unknown; role?: unknown };

  if (typeof accountId !== 'string' || accountId.trim().length === 0) {
    return json({ error: 'accountId_required' }, 400);
  }
  if (!isStaffRole(role)) {
    return json({ error: 'invalid_role' }, 400);
  }

  // Nobody may change their OWN admin row — no self-escalation, no
  // self-demotion. Applies to super_admin too.
  if (accountId === principal.id) {
    return json({ error: 'cannot_target_self' }, 400);
  }

  // Rank check #1 — the role being handed out: the actor must be allowed to
  // manage it (main_admin may grant sub-roles only, never main/super).
  const grantBlock = requireOutranks(principal, role);
  if (grantBlock) return grantBlock;

  const db = getDb();

  // The target account must already exist (this endpoint grants roles to
  // existing accounts, it never creates one). Fail 404 rather than writing a
  // dangling admins row that references a non-existent account.
  const target = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (target.length === 0) {
    return json({ error: 'account_not_found' }, 404);
  }

  // Rank check #2 — the target's CURRENT role (when already staff): changing a
  // row is managing its holder, so a main_admin cannot touch an existing
  // super_admin/main_admin row even to "demote" it.
  const previousRole = await adminRoleOf(accountId);
  const changeBlock = requireOutranks(principal, previousRole);
  if (changeBlock) return changeBlock;

  // Upsert the admins row (accountId is the PK → change-in-place on conflict).
  await db
    .insert(admins)
    .values({ accountId, role })
    .onConflictDoUpdate({ target: admins.accountId, set: { role } });

  // Granting coach → make sure a coach_profiles row exists so the account is
  // immediately visible in the coach roster and coach console. DO NOTHING on
  // conflict so an existing profile (bio/avatar/capacity) is left untouched.
  if (role === 'coach') {
    await db
      .insert(coachProfiles)
      .values({ accountId })
      .onConflictDoNothing({ target: coachProfiles.accountId });
  }

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(principal, 'roles.grant', 'account', accountId, { role, previousRole }, ip);

  return json({ ok: true }, 200);
}
