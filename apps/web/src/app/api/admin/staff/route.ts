import { accounts, admins, coachProfiles } from '@gym/db';
import { asc, eq } from 'drizzle-orm';
import type { StaffRole } from '@/lib/auth';
import { logAudit, requirePermission } from '@/lib/authz';
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
 * Both guarded by requirePermission('roles.grant') — super_admin only — and
 * every mutation is audited. (Revoke lives in [accountId]/route.ts as DELETE.)
 */

// The full set of assignable staff roles (mirrors the admins.role enum in the
// DB schema). Anything outside this set is rejected 400 so a typo can never
// write a bogus role that the guard layer would then fail-closed on forever.
const ASSIGNABLE_ROLES: readonly StaffRole[] = [
  'super_admin',
  'member_admin',
  'nutrition_admin',
  'content_admin',
  'support_admin',
  'coach',
];

function isAssignableRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(v);
}

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
  if (!isAssignableRole(role)) {
    return json({ error: 'invalid_role' }, 400);
  }

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
  await logAudit(principal, 'roles.grant', 'account', accountId, { role }, ip);

  return json({ ok: true }, 200);
}
