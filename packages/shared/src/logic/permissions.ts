/**
 * Staff permission matrix — the SINGLE source of truth for role → capability,
 * shared by the web API guards (`apps/web/src/lib/authz.ts`), the admin/coach
 * consoles, and the mobile staff surface. Pure logic — no I/O (CLAUDE.md rule
 * 10). Built on the role/rank rules in `staffRoles.ts`.
 *
 * Why this file exists: the role→permission map was previously hand-duplicated
 * four ways (the authz.ts switch, the web layout `canX` helpers, ~10 page
 * `CAN_*` arrays, and mobile `nav.ts`) with proven drift (defect A7). Everything
 * now derives from `ROLE_PRESETS` here.
 *
 * Enforcement contract (RBAC design §1.4):
 *   - super_admin AND main_admin BYPASS the matrix — `hasPermission` returns
 *     true for both before consulting presets. main_admin's restriction is
 *     RANK, not permissions (it may never target a peer/higher staff account —
 *     see requireOutranks + canManageRole in staffRoles.ts).
 *   - Everything not explicitly granted is DENIED (fail closed). An unknown /
 *     corrupt role string resolves to no permissions.
 */

import type { StaffRole } from './staffRoles';

/**
 * Every permission key the console understands, as an ordered readonly tuple so
 * the Permission union is derived from ONE list and the test suite can snapshot
 * the exact strings (a rename breaks the snapshot — routes match on these
 * literals across ~35 guard sites, so churn must be intentional).
 *
 * KEEP the existing strings that routes already pass; the RBAC design adds four
 * new keys and retires `content.video.publish` (superseded by `content.manage`
 * for admins and `content.video.own` for coaches).
 */
export const ALL_PERMISSIONS = [
  // --- member administration
  'members.read', // read the member directory
  'members.suspend', // suspend/reactivate a member account
  'coach.assign', // assign a coach to a user
  'subscription.override', // override a member's subscription tier
  // --- audit + roles
  'audit.read', // read the audit log
  'roles.grant', // grant/revoke staff roles
  // --- support
  'support.thread.read', // list/read support threads (org-wide, no ownership scoping)
  'support.thread.reply', // reply into a support thread
  // --- coach lifecycle + money queues
  'coach.application.review', // approve/reject coach enrollment applications + tier requests
  'payments.review', // approve/reject/refund manual payment requests
  'promo.manage', // create/toggle promo codes
  'pricing.manage', // edit regional tier prices
  'wallet.manage', // view all wallets, record adjustments/payouts
  // --- content
  'content.manage', // org-wide plan-video CRUD (create/retier/remove ANY row)
  'content.video.own', // coach-scoped video CRUD (route enforces createdBy=principal.id)
  // --- coach self-scoped
  'coach.message.user', // author a 'coach' reply into a user's thread
  'coach.user.read', // read an assigned user's coach threads / profile
  'coach.wallet.read', // a coach reading their OWN wallet (route self-scopes)
  // --- new, tightly-scoped
  'client.tier_grant', // coach-initiated client tier grant (in NO preset — fixes A1)
  'broadcast.send', // announcements / push broadcast (super/main only)
  // --- P1/P2 admin capabilities (this wave; appended so the snapshot only grows)
  'members.manage_credentials', // admin password reset / force sign-out / identity correction (super/main)
  'payouts.review', // approve/reject/mark-paid coach payout requests (super/main)
  'analytics.read', // read revenue / churn / coach-performance analytics (super/main)
  'permissions.override', // grant/strip per-account permission overrides (super/main)
  'moderation.manage', // moderate member-visible content (custom foods, progress photos, milestones)
  'catalog.manage', // CRUD the exercises/plans catalog (content surface)
  'gamification.manage', // XP corrections, badge audit/revoke, challenge moderation (super/main)
] as const;

/** A permission key. Union derived from ALL_PERMISSIONS — never widen by hand. */
export type Permission = (typeof ALL_PERMISSIONS)[number];

/** Type guard for unknown input (e.g. a permission string off the wire). */
export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(value)
  );
}

/**
 * Role → granted permissions. super_admin/main_admin carry the FULL set for
 * completeness (and so the mobile preset-derived fallback is correct for them),
 * but `hasPermission` short-circuits them anyway. Anything absent is denied.
 *
 *  - member_admin:   member ops + the two review queues it owns.
 *  - support_admin:  read members + the support thread pair.
 *  - content_admin:  org-wide content + the catalog + content moderation.
 *  - coach:          self-scoped messaging/reads + OWN-video CRUD + OWN wallet.
 *                    NOT client.tier_grant, NOT content.manage.
 *
 * The P1/P2 keys (members.manage_credentials, payouts.review, analytics.read,
 * permissions.override, gamification.manage) sit in NO sub-role preset — they
 * are super/main-only, reachable through bypass or a per-account override.
 * content_admin additionally carries catalog.manage + moderation.manage.
 *  - nutrition_admin: DEPRECATED — empty. The enum value survives for legacy DB
 *                    rows, but GRANTABLE_ROLES excludes it so no new grants land
 *                    and both consoles keep it out of the entry surface (A6).
 */
export const ROLE_PRESETS: Record<StaffRole, readonly Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  main_admin: ALL_PERMISSIONS,
  member_admin: [
    'members.read',
    'members.suspend',
    'coach.assign',
    'subscription.override',
    'coach.application.review',
    'payments.review',
  ],
  support_admin: ['members.read', 'support.thread.read', 'support.thread.reply'],
  content_admin: ['content.manage', 'catalog.manage', 'moderation.manage'],
  coach: ['coach.message.user', 'coach.user.read', 'content.video.own', 'coach.wallet.read'],
  nutrition_admin: [],
};

/**
 * Does `role` hold `perm`? super_admin/main_admin bypass (true for every key).
 * Fail closed: an unknown/corrupt role has no preset → false.
 */
export function hasPermission(role: StaffRole, perm: Permission): boolean {
  if (role === 'super_admin' || role === 'main_admin') return true;
  const preset = ROLE_PRESETS[role];
  return preset ? preset.includes(perm) : false;
}

/**
 * The full permission list for `role` — bypass roles return every key (so the
 * `POST /api/staff/login` + `GET /api/me/staff` `permissions` payload and the
 * mobile fallback are consistent). Returns a fresh array; unknown role → [].
 */
export function permissionsForRole(role: StaffRole): Permission[] {
  if (role === 'super_admin' || role === 'main_admin') return [...ALL_PERMISSIONS];
  return [...(ROLE_PRESETS[role] ?? [])];
}

/** Merges role defaults with explicit per-account grants and denials. */
export function effectivePermissionsForRole(
  role: StaffRole,
  overrides: ReadonlyMap<Permission, boolean>,
): Permission[] {
  if (role === 'super_admin') return [...ALL_PERMISSIONS];
  const effective = new Set(permissionsForRole(role));
  for (const [permission, allow] of overrides) {
    if (allow) effective.add(permission);
    else effective.delete(permission);
  }
  return ALL_PERMISSIONS.filter((permission) => effective.has(permission));
}

/**
 * Roles that may open the ADMIN console — single source for the web `/admin`
 * layout guard AND mobile `canOpenAdminConsole`. coach is intentionally absent
 * (it opens the COACH console). nutrition_admin is absent — it has no admin
 * surface (empty preset) and would otherwise land in a 403 trap.
 */
export const ADMIN_CONSOLE_ROLES: readonly StaffRole[] = [
  'super_admin',
  'main_admin',
  'member_admin',
  'content_admin',
  'support_admin',
];

/**
 * Roles that may open the COACH console. Top admins are included so they can
 * inspect/operate coach surfaces without a coach assignment.
 */
export const COACH_CONSOLE_ROLES: readonly StaffRole[] = ['coach', 'super_admin', 'main_admin'];

/**
 * Roles an admin may GRANT — STAFF_ROLES minus the deprecated nutrition_admin.
 * Drives the grant dropdown AND the server whitelist in `POST /api/admin/staff`
 * (A6). Rank still filters this further per actor via assignableRolesFor.
 *
 * Written as an explicit literal (not `STAFF_ROLES.filter(...)`) so this module
 * carries NO runtime import of `staffRoles` — the `StaffRole` import above is
 * type-only and fully erased. That keeps `permissions.ts` loadable by the
 * `node --test` ESM runner (which cannot resolve extensionless relative `.ts`
 * imports) while its own imports stay extensionless for the app bundlers. The
 * ordering + membership are pinned by `permissions.test.ts`, which asserts this
 * equals `STAFF_ROLES.filter((r) => r !== 'nutrition_admin')`, so any drift in
 * the role enum breaks the test and forces this list to be updated.
 */
export const GRANTABLE_ROLES: readonly StaffRole[] = [
  'super_admin',
  'main_admin',
  'member_admin',
  'content_admin',
  'support_admin',
  'coach',
];
