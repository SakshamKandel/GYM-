import {
  ALL_PERMISSIONS,
  effectivePermissionsForRole,
  isPermission,
  type Permission,
  permissionsForRole,
  type StaffRole,
} from '@gym/shared';
import { z } from 'zod';
import {
  adminRoleOf,
  assertNotPartnerOverrideTarget,
  clearPermissionOverride,
  getAccountOverrides,
  logAudit,
  requireOutranks,
  requirePermission,
  setPermissionOverride,
} from '@/lib/authz';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Per-account permission overrides (P2-20) — the surface that makes "everything
 * can be managed" literal: on TOP of the role preset, an operator can grant an
 * extra capability to one staff account or strip one the preset gives. This is
 * how a trusted in-house coach gets `client.tier_grant` without widening the
 * whole coach role, or a member_admin loses `payments.review` individually.
 *
 *  - GET → the target's effective permission set with provenance per key
 *          ({ preset, override: 'allow'|'deny'|null, effective }), so the UI can
 *          render "effective = preset + grants − denials" unambiguously.
 *  - PUT → set or clear ONE override: { perm, allow } where allow=true grants an
 *          extra permission, allow=false strips a preset one, and allow=null
 *          clears the override (revert to the role preset). Returns the fresh
 *          payload so the client re-syncs without a second request.
 *
 * Guards (fail closed, layered exactly like the sibling staff routes):
 *  - requirePermission('permissions.override') — super_admin + main_admin only
 *    (in NO sub-role preset; reachable via bypass or, recursively, an override).
 *  - requireOutranks against the target's CURRENT role — a main_admin may adjust
 *    sub-role staff only, never a peer main_admin or a super_admin.
 *  - super_admin targets are the FP0 SAFETY FLOOR: their permissions can never
 *    be overridden (the merge helper ignores overrides for super_admin anyway,
 *    so a write would be a silent no-op — we reject it explicitly instead).
 *  - partner targets are a SECOND FLOOR (§2/§8 threat #6, the biggest
 *    escalation surface): `assertNotPartnerOverrideTarget` refuses any write
 *    that would grant a partner account a permission outside its native
 *    {meals.own, orders.fulfill} pair — a partner must never gain
 *    members.read, payments.review, or any other admin/coach capability.
 *  - No self-target: an operator can neither self-escalate nor self-lockout.
 * Every change is audited `permissions.override` with { perm, allow } where allow
 * is 'allow' | 'deny' | 'cleared'.
 */

const bodySchema = z.object({
  perm: z.string(),
  // true = grant an extra permission, false = strip a preset one, null = clear
  // the override entirely (revert to the role preset).
  allow: z.boolean().nullable(),
});

interface PermissionRow {
  key: Permission;
  /** Granted by the role preset (before overrides). */
  preset: boolean;
  /** The explicit per-account override, if any. */
  override: 'allow' | 'deny' | null;
  /** The final result the guards enforce (preset + grants − denials). */
  effective: boolean;
}

/**
 * Builds the provenance payload for one staff account. Pure read of the override
 * table merged against the role preset via the SAME shared helpers the guards
 * use, so what the console shows can never drift from what enforcement does.
 */
async function buildPayload(
  accountId: string,
  role: StaffRole,
): Promise<{
  accountId: string;
  role: StaffRole;
  locked: boolean;
  permissions: PermissionRow[];
}> {
  const overrides = await getAccountOverrides(accountId);
  const preset = new Set(permissionsForRole(role));
  const effective = new Set(effectivePermissionsForRole(role, overrides));
  const permissions: PermissionRow[] = ALL_PERMISSIONS.map((key) => {
    const override: 'allow' | 'deny' | null = overrides.has(key)
      ? overrides.get(key)
        ? 'allow'
        : 'deny'
      : null;
    return {
      key,
      preset: preset.has(key),
      override,
      effective: effective.has(key),
    };
  });
  // super_admin is the safety floor — overrides never apply, so the UI locks.
  return { accountId, role, locked: role === 'super_admin', permissions };
}

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const principal = await requirePermission(req, 'permissions.override');
  if (principal instanceof Response) return principal;

  const { accountId } = await params;

  const targetRole = await adminRoleOf(accountId);
  if (targetRole === null) return json({ error: 'not_staff' }, 404);

  // Rank: an operator may only inspect/adjust accounts they can manage.
  const rankBlock = requireOutranks(principal, targetRole);
  if (rankBlock) return rankBlock;

  return json(await buildPayload(accountId, targetRole), 200);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const principal = await requirePermission(req, 'permissions.override');
  if (principal instanceof Response) return principal;

  const { accountId } = await params;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const { perm, allow } = parsed.data;
  // Reject unknown keys so a typo can never write a dangling override row that
  // no guard would ever consult (and that would clutter the provenance view).
  if (!isPermission(perm)) return json({ error: 'invalid_permission' }, 400);

  // No self-target: prevents both self-escalation and self-lockout, mirroring
  // the role grant/revoke routes.
  if (accountId === principal.id) {
    return json({ error: 'cannot_target_self' }, 400);
  }

  const targetRole = await adminRoleOf(accountId);
  if (targetRole === null) return json({ error: 'not_staff' }, 404);

  const rankBlock = requireOutranks(principal, targetRole);
  if (rankBlock) return rankBlock;

  // FP0 safety floor: a super_admin's permissions can never be overridden — the
  // merge ignores overrides for it, so persisting one would only mislead.
  if (targetRole === 'super_admin') {
    return json({ error: 'cannot_modify_super_admin' }, 403);
  }

  // Second floor (§2/§8 threat #6): a partner's overridable surface is exactly
  // its native {meals.own, orders.fulfill} pair — no override (grant, strip,
  // or clear) may touch any other key on a partner target.
  const partnerBlock = assertNotPartnerOverrideTarget(targetRole, perm);
  if (partnerBlock) return partnerBlock;

  const ip = req.headers.get('x-forwarded-for');

  if (allow === null) {
    await clearPermissionOverride(accountId, perm);
  } else {
    await setPermissionOverride(accountId, perm, allow, principal.id);
  }

  await logAudit(
    principal,
    'permissions.override',
    'account',
    accountId,
    { perm, allow: allow === null ? 'cleared' : allow ? 'allow' : 'deny' },
    ip,
  );

  return json(await buildPayload(accountId, targetRole), 200);
}
