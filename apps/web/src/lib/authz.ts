import { auditLog, coachAssignments } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { bearerToken, staffForToken, type StaffRole } from './auth';
import { getDb } from './db';
import { json } from './http';
import { staffTokenFromCookie } from './staffSession';

/**
 * Guard layer mirroring the existing inline `if (!user) return json(...)`
 * pattern in the API routes: each guard returns EITHER a Principal to continue
 * with, OR a Response to early-return. Roles are HARDCODED here (minimal CTO
 * cut) — no data-driven permission engine. Fail closed everywhere.
 */

export interface Principal {
  id: string;
  email: string;
  role: StaffRole;
}

/** Every permission the console understands. Extend the switch below to grant. */
export type Permission =
  | 'coach.message.user' // author a 'coach' reply into a user's thread
  | 'coach.user.read' // read an assigned user's coach threads / profile
  | 'content.video.publish' // publish/attach a plan video
  | 'members.read' // read the member directory
  | 'coach.assign' // assign a coach to a user
  | 'members.suspend' // suspend/reactivate a member account
  | 'subscription.override' // override a member's subscription tier
  | 'audit.read' // read the audit log
  | 'roles.grant'; // grant/revoke staff roles

/**
 * Hardcoded role → permission matrix. super_admin bypasses all. Anything not
 * listed is denied (fail closed).
 */
function roleHasPermission(role: StaffRole, perm: Permission): boolean {
  if (role === 'super_admin') return true;
  switch (role) {
    case 'coach':
      return (
        perm === 'coach.message.user' ||
        perm === 'coach.user.read' ||
        perm === 'content.video.publish'
      );
    case 'content_admin':
      return perm === 'content.video.publish';
    case 'member_admin':
      return (
        perm === 'members.read' ||
        perm === 'coach.assign' ||
        perm === 'members.suspend' ||
        perm === 'subscription.override'
      );
    case 'support_admin':
      return perm === 'members.read';
    default:
      return false;
  }
}

/**
 * Resolves the caller to a staff Principal, or a 401/403 Response. Accepts
 * EITHER the mobile/API `Authorization: Bearer` token OR the browser console's
 * httpOnly `gt_staff` cookie (bearer wins if both are present) — so the same
 * guards protect API clients and the coach console's same-origin fetches.
 */
export async function requireStaff(req: Request): Promise<Principal | Response> {
  const token = bearerToken(req) ?? (await staffTokenFromCookie());
  if (!token) return json({ error: 'unauthorized' }, 401);
  const staff = await staffForToken(token);
  if (!staff) return json({ error: 'forbidden' }, 403);
  return { id: staff.user.id, email: staff.user.email, role: staff.role };
}

/** Like requireStaff, then enforces a specific permission (fail closed). */
export async function requirePermission(
  req: Request,
  perm: Permission,
): Promise<Principal | Response> {
  const principal = await requireStaff(req);
  if (principal instanceof Response) return principal;
  if (!roleHasPermission(principal.role, perm)) {
    return json({ error: 'forbidden' }, 403);
  }
  return principal;
}

/**
 * True when `principal` (a coach) has an ACTIVE assignment over `userId`.
 * super_admin is allowed through without an assignment row.
 */
export async function requireCoachOwnsUser(
  principal: Principal,
  userId: string,
): Promise<boolean> {
  if (principal.role === 'super_admin') return true;
  const rows = await getDb()
    .select({ id: coachAssignments.id })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.coachId, principal.id),
        eq(coachAssignments.userId, userId),
        eq(coachAssignments.status, 'active'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Appends an audit row. Best-effort context; never throws to the caller path. */
export async function logAudit(
  actor: Principal | null,
  action: string,
  targetType: string,
  targetId: string | null,
  meta: Record<string, unknown> = {},
  ip: string | null = null,
): Promise<void> {
  await getDb().insert(auditLog).values({
    actorId: actor?.id ?? null,
    action,
    targetType,
    targetId,
    meta,
    ip,
  });
}
