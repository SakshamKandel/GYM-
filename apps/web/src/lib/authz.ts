import {
  adminPermissionOverrides,
  admins,
  auditLog,
  coachAssignments,
  mealPartners,
} from '@gym/db';
import {
  ALL_PERMISSIONS,
  canManageRole,
  effectivePermissionsForRole,
  type Permission,
} from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { bearerToken, staffForToken, type StaffRole } from './auth';
import { getDb } from './db';
import { json } from './http';
import { staffTokenFromCookie } from './staffSession';

/**
 * Guard layer mirroring the existing inline `if (!user) return json(...)`
 * pattern in the API routes: each guard returns EITHER a Principal to continue
 * with, OR a Response to early-return. The role-to-permission matrix and
 * override merge live in @gym/shared, and every guard delegates to that single
 * implementation. Fail closed everywhere.
 */

// Re-exported so existing route call sites can keep importing the Permission
// type from '@/lib/authz' unchanged; the canonical union lives in @gym/shared.
export type { Permission };

export interface Principal {
  id: string;
  email: string;
  role: StaffRole;
}

/**
 * Minimal actor identity accepted by the audit/tier helpers. A staff Principal
 * satisfies it structurally; SELF-SERVE member routes (POST /api/subscription/
 * tier, buddy trial, DELETE /api/me, logout-all) pass `{ id: user.id }` — only
 * the id is ever persisted (audit_log.actor_id, coach_assignments.assigned_by).
 */
export interface AuditActor {
  id: string;
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

/**
 * All per-account permission overrides as a `perm → allow` map (one query).
 * allow=true grants an EXTRA permission; allow=false STRIPS a preset one. A
 * missing entry means "defer to the role preset". Exported so the future staff
 * override-management routes read the same shape they write.
 *
 * Throws on DB error so callers fail closed. Falling back to the role preset
 * could restore a permission that an unread explicit deny removed.
 */
export async function getAccountOverrides(
  accountId: string,
): Promise<Map<Permission, boolean>> {
  const rows = await getDb()
    .select({ perm: adminPermissionOverrides.perm, allow: adminPermissionOverrides.allow })
    .from(adminPermissionOverrides)
    .where(eq(adminPermissionOverrides.accountId, accountId));
  const map = new Map<Permission, boolean>();
  for (const row of rows) map.set(row.perm as Permission, row.allow);
  return map;
}

/**
 * Effective permission = role preset merged with per-account overrides.
 *  - super_admin is a SAFETY FLOOR: it holds everything and can NEVER be
 *    stripped (overrides do not apply to it) — so a misconfigured/hostile
 *    override can't lock the top admin out of the console.
 *  - allow=true grants a permission the preset lacks; allow=false strips one it
 *    has (main_admin included — only super_admin is protected).
 *  - No override for `perm` → the preset decides.
 * Pure — takes the already-fetched override map so enforcement stays one query.
 */
/**
 * The complete effective permission set for one staff principal. Role presets
 * and per-account overrides are merged once, so callers that need to check
 * several capabilities (overview/nav/content OR-guards) cannot accidentally
 * bypass an explicit deny by falling back to role presets.
 *
 * Override lookup errors intentionally propagate. Returning preset permissions
 * when a deny row cannot be read would widen access during a database failure;
 * server routes catch this and return 503, while server components fail without
 * rendering protected data.
 */
export async function effectivePermissionSet(
  principal: Principal,
): Promise<ReadonlySet<Permission>> {
  if (principal.role === 'super_admin') return new Set(ALL_PERMISSIONS);
  const overrides = await getAccountOverrides(principal.id);
  return new Set(effectivePermissionsForRole(principal.role, overrides));
}

/**
 * Upsert a single per-account permission override (grant or strip). For future
 * `permissions.override`-gated staff routes; kept here so read/write share the
 * override table access. Best-effort audit is the caller's responsibility.
 */
export async function setPermissionOverride(
  accountId: string,
  perm: Permission,
  allow: boolean,
  grantedBy: string | null,
): Promise<void> {
  await getDb()
    .insert(adminPermissionOverrides)
    .values({ accountId, perm, allow, grantedBy })
    .onConflictDoUpdate({
      target: [adminPermissionOverrides.accountId, adminPermissionOverrides.perm],
      set: { allow, grantedBy, createdAt: new Date() },
    });
}

/** Remove a per-account override, reverting `perm` to the role preset. */
export async function clearPermissionOverride(
  accountId: string,
  perm: Permission,
): Promise<void> {
  await getDb()
    .delete(adminPermissionOverrides)
    .where(
      and(
        eq(adminPermissionOverrides.accountId, accountId),
        eq(adminPermissionOverrides.perm, perm),
      ),
    );
}

/**
 * Like requireStaff, then enforces a specific permission (fail closed), merging
 * any per-account overrides. super_admin short-circuits BEFORE the override
 * query (zero extra queries, never strippable). For everyone else exactly one
 * override query runs; a lookup failure returns 503 so an unread explicit deny
 * can never be widened back to the role preset.
 */
export async function requirePermission(
  req: Request,
  perm: Permission,
): Promise<Principal | Response> {
  const principal = await requireStaff(req);
  if (principal instanceof Response) return principal;
  if (principal.role === 'super_admin') return principal; // safety floor, no query
  let permissions: ReadonlySet<Permission>;
  try {
    permissions = await effectivePermissionSet(principal);
  } catch (err) {
    console.error('permission override lookup failed:', err);
    return json({ error: 'authorization_unavailable' }, 503);
  }
  if (!permissions.has(perm)) {
    return json({ error: 'forbidden' }, 403);
  }
  return principal;
}

/**
 * Like `requirePermission`, but accepts an OR-list and performs one override
 * lookup. Used by content routes where an org-wide manager OR the row owner may
 * proceed. The returned permission set also lets the caller choose row scope
 * without re-checking the role preset.
 */
export async function requireAnyPermission(
  req: Request,
  required: readonly Permission[],
): Promise<{ principal: Principal; permissions: ReadonlySet<Permission> } | Response> {
  const principal = await requireStaff(req);
  if (principal instanceof Response) return principal;

  let permissions: ReadonlySet<Permission>;
  try {
    permissions = await effectivePermissionSet(principal);
  } catch (err) {
    console.error('permission override lookup failed:', err);
    return json({ error: 'authorization_unavailable' }, 503);
  }

  if (!required.some((perm) => permissions.has(perm))) {
    return json({ error: 'forbidden' }, 403);
  }
  return { principal, permissions };
}

/**
 * True when `principal` (a coach) has an ACTIVE assignment over `userId`.
 * super_admin and main_admin are allowed through without an assignment row —
 * the target here is always a MEMBER, never a staff row, so no rank check.
 */
export async function requireCoachOwnsUser(
  principal: Principal,
  userId: string,
): Promise<boolean> {
  if (principal.role === 'super_admin' || principal.role === 'main_admin') return true;
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

/**
 * The target account's admin role, or null when the account is not staff.
 * Used by the rank guards below before any operation that TARGETS an account.
 */
export async function adminRoleOf(accountId: string): Promise<StaffRole | null> {
  const rows = await getDb()
    .select({ role: admins.role })
    .from(admins)
    .where(eq(admins.accountId, accountId))
    .limit(1);
  return rows[0]?.role ?? null;
}

/**
 * Rank guard for operations that target a STAFF account (grant/change/revoke a
 * role, suspend the holder). Returns null to continue, or a 403 Response when
 * the actor does not outrank `targetRole` (per canManageRole: super_admin
 * manages everyone; main_admin manages sub-roles only; sub-roles manage
 * nobody). A null `targetRole` (target is not staff) always passes — rank only
 * protects staff rows. Identity self-checks stay at the call sites.
 */
export function requireOutranks(
  principal: Principal,
  targetRole: StaffRole | null,
): Response | null {
  if (targetRole === null) return null;
  if (!canManageRole(principal.role, targetRole)) {
    return json({ error: 'insufficient_rank' }, 403);
  }
  return null;
}

/**
 * The identity a partner-portal route works with: the resolved staff Principal
 * PLUS the caller's own `meal_partners.id`. Every partner query MUST be scoped
 * by this guard-derived `partnerId` — never a value from the request body or
 * params — so one restaurant can never read or mutate another's rows.
 */
export interface PartnerPrincipal {
  principal: Principal;
  partnerId: string;
}

/**
 * Partner-portal guard. requireStaff, then: role must be exactly 'partner', and
 * the caller must own an ACTIVE `meal_partners` row (looked up by accountId, the
 * UNIQUE login identity). Returns `{ principal, partnerId }` or a 403 Response.
 *
 * Fail closed: no partner row, or `isActive=false` (admin deactivation), → 403.
 * Deactivation also deletes the partner's sessions (a second kill-switch in the
 * admin route), so a live token can't outrace the isActive flip — but this guard
 * enforces isActive on every request regardless, closing any residual race.
 */
export async function requirePartner(
  req: Request,
): Promise<PartnerPrincipal | Response> {
  const principal = await requireStaff(req);
  if (principal instanceof Response) return principal;
  if (principal.role !== 'partner') return json({ error: 'forbidden' }, 403);
  const rows = await getDb()
    .select({ id: mealPartners.id, isActive: mealPartners.isActive })
    .from(mealPartners)
    .where(eq(mealPartners.accountId, principal.id))
    .limit(1);
  const row = rows[0];
  if (!row || !row.isActive) return json({ error: 'forbidden' }, 403);
  return { principal, partnerId: row.id };
}

/**
 * The only permissions a partner account may ever hold. A partner's role preset
 * is exactly this set; the permission-override rail must never widen a partner
 * beyond it (threat #6 — the biggest escalation surface).
 */
const PARTNER_NATIVE_PERMISSIONS: readonly Permission[] = ['meals.own', 'orders.fulfill'];

/**
 * Guard for the permission-override route/UI: refuses any override that TARGETS
 * a partner account with a permission outside its native set. A partner must
 * never be granted `members.read`, `payments.review`, or any other key — that
 * would turn the delivery-only role into an admin. Overrides that touch only the
 * partner's own two native keys (e.g. an admin temporarily stripping
 * `orders.fulfill`) are allowed; everything else is 403.
 *
 * Returns null to continue, or a 403 Response. A null `targetRole` (target is
 * not a partner) always passes — this rail only constrains partner targets.
 */
export function assertNotPartnerOverrideTarget(
  targetRole: StaffRole | null,
  perm: Permission,
): Response | null {
  if (targetRole !== 'partner') return null;
  if (PARTNER_NATIVE_PERMISSIONS.includes(perm)) return null;
  return json({ error: 'partner_override_forbidden' }, 403);
}

/**
 * Appends an audit row. Best-effort context; NEVER throws to the caller path
 * (A5). The prior version awaited an unguarded insert, so a transient audit
 * failure would 500 an ALREADY-COMMITTED mutation — and the client retry would
 * then 404 on CAS routes. We swallow the failure (console.error only) so the
 * primary operation's success is never undone by an audit write.
 */
export async function logAudit(
  actor: AuditActor | null,
  action: string,
  targetType: string,
  targetId: string | null,
  meta: Record<string, unknown> = {},
  ip: string | null = null,
): Promise<void> {
  try {
    await getDb().insert(auditLog).values({
      actorId: actor?.id ?? null,
      action,
      targetType,
      targetId,
      meta,
      ip,
    });
  } catch (err) {
    console.error(`logAudit failed for action "${action}":`, err);
  }
}
