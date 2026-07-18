/**
 * Staff role hierarchy — the single source of truth for role names and rank
 * rules, shared by the web API guards, the admin/coach consoles, and (later)
 * the mobile staff surface. Pure logic — no I/O (CLAUDE.md rule 10).
 *
 * Hierarchy (2026-07 owner spec):
 *   super_admin  (rank 3) — all-powerful, including managing main_admins.
 *   main_admin   (rank 2) — every permission super_admin has, but no operation
 *                           may ever target a peer or higher rank.
 *   sub-roles    (rank 1) — member_admin, nutrition_admin, content_admin,
 *                           support_admin, coach. Equal lowest tier among
 *                           themselves for MANAGEMENT purposes (their feature
 *                           permissions still differ — see the web authz matrix).
 *
 * NOTE: rank governs role-vs-role management only. The "nobody may change
 * their OWN admin row" rule is identity-based (actor id === target id) and is
 * enforced at the route level, not here.
 */

/**
 * Every staff role, highest rank first. Mirrors the admins.role DB enum.
 *
 * DEPRECATED: `nutrition_admin` is retained ONLY so legacy DB rows keep parsing.
 * It carries an EMPTY permission preset (see permissions.ts ROLE_PRESETS) and is
 * excluded from `GRANTABLE_ROLES` (permissions.ts), so it can no longer be
 * granted and neither console offers it as an entry point (fixes A6: the web
 * login-loop / mobile 403-trap it used to cause). Do NOT add it back to any
 * grant dropdown or preset.
 */
export const STAFF_ROLES = [
  'super_admin',
  'main_admin',
  'member_admin',
  'nutrition_admin',
  'content_admin',
  'support_admin',
  'coach',
  // Meal-delivery restaurant operator (2026-07-18). Web-only console. Rank 0 —
  // outranks nobody; its capabilities are permission-gated (meals.own /
  // orders.fulfill), NOT rank-gated, so no sub-role can "manage" a partner via
  // rank. Deliberately EXCLUDED from GRANTABLE_ROLES (permissions.ts) so it can
  // never be minted through the generic staff-grant path — only via
  // POST /api/admin/partners, which also writes the meal_partners identity row.
  'partner',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** Type guard for unknown input (e.g. a request body's `role` field). */
export function isStaffRole(value: unknown): value is StaffRole {
  return (
    typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)
  );
}

/** Numeric rank: higher number = higher authority. Sub-roles are all equal. */
export const STAFF_ROLE_RANK: Record<StaffRole, number> = {
  super_admin: 3,
  main_admin: 2,
  member_admin: 1,
  nutrition_admin: 1,
  content_admin: 1,
  support_admin: 1,
  coach: 1,
  // Below every sub-role. partner outranks nobody and nobody "manages" it by
  // rank — partner operations are permission-gated. main_admin (rank 2)
  // strictly outranks it so a bogus partner grant could still be cleaned up.
  partner: 0,
};

/** True when `actor` STRICTLY outranks `target` (equal rank is NOT enough). */
export function outranks(actor: StaffRole, target: StaffRole): boolean {
  return STAFF_ROLE_RANK[actor] > STAFF_ROLE_RANK[target];
}

/**
 * May `actor` manage (grant, change, revoke, suspend-the-holder-of) a row
 * carrying `target`?
 *
 *  - super_admin: always — "all-powerful" includes managing peers, so a second
 *    super_admin can be created and an existing one revoked (never by itself;
 *    the identity self-check lives at the route level).
 *  - everyone else: only when strictly outranking the target. main_admin →
 *    sub-roles only; sub-roles → nobody.
 */
export function canManageRole(actor: StaffRole, target: StaffRole): boolean {
  if (actor === 'super_admin') return true;
  return outranks(actor, target);
}

/**
 * The roles `actor` may hand out (drives the grant dropdown and the server
 * whitelist). Order follows STAFF_ROLES (highest first).
 */
export function assignableRolesFor(actor: StaffRole): StaffRole[] {
  return STAFF_ROLES.filter((role) => canManageRole(actor, role));
}
