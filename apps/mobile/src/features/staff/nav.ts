import { router, type Href } from 'expo-router';

/**
 * Staff console route helpers.
 *
 * The staff area lives OUTSIDE the (tabs) onboarding gate at `/staff/*`, so a
 * staff member lands straight in the console after sign-in without completing
 * the athlete onboarding flow.
 *
 * `.expo/types/router.d.ts` only regenerates when the dev server runs, so these
 * freshly-added routes aren't in the generated `Href` union yet — the casts are
 * the same escape hatch used by features/auth/nav.ts and are trivial to delete
 * once the types catch up. All screen agents MUST push to these constants so
 * every route string is defined in exactly one place.
 */

export const STAFF_ROUTES = {
  /** The staff hub — role-aware entry with Coach / Admin console cards. */
  hub: '/staff',

  // ── Coach area ──────────────────────────────────────────────
  /** Coach inbox — the caller's assigned client roster. */
  coachInbox: '/staff/coach',
  /** One client's coach_chat thread. Pass the client's user id. */
  coachThread: (userId: string): string => `/staff/coach/${userId}`,
  /** The signed-in coach's own editable profile card. */
  coachProfile: '/staff/coach/profile',
  /** The coach's plan-video library (view counts + tier). */
  coachVideos: '/staff/coach/videos',
  /** One client's detail — set/extend their tier + expiry. Pass the user id. */
  coachClient: (userId: string): string => `/staff/coach/client/${userId}`,

  // ── Admin area ──────────────────────────────────────────────
  /** Admin console home — the overview dashboard. */
  adminHome: '/staff/admin',
  /** Member directory. */
  adminMembers: '/staff/admin/members',
  /** A single member's detail (tier / status / coach). Pass the member id. */
  adminMember: (id: string): string => `/staff/admin/members/${id}`,
  /** Coach pool + assignment management. */
  adminCoaches: '/staff/admin/coaches',
  /** Plan-video library (screen file: staff/admin/content.tsx). */
  adminVideos: '/staff/admin/content',
  /** Staff & roles management (super_admin + main_admin). */
  adminStaff: '/staff/admin/staff',
  /** Audit trail (super_admin + main_admin). */
  adminAudit: '/staff/admin/audit',
} as const;

/** router.push through the typed-routes escape hatch. */
export function pushStaff(path: string): void {
  router.push(path as Href);
}

/** router.replace through the typed-routes escape hatch. */
export function replaceStaff(path: string): void {
  router.replace(path as Href);
}

// ── Role → visibility helpers (mirror the server role matrix) ──

/**
 * The two top-rank roles. main_admin holds the full permission set (its only
 * limits are rank checks on staff mutations), so everywhere super_admin may
 * go, main_admin goes too — including the Staff & roles and Audit screens.
 */
export function isTopAdmin(role: string | null): boolean {
  return role === 'super_admin' || role === 'main_admin';
}

/** Roles that may open the coach console (coach, super_admin or main_admin). */
export function canOpenCoachConsole(role: string | null): boolean {
  return role === 'coach' || isTopAdmin(role);
}

/**
 * Roles that may open the admin console. Any admin-tier role qualifies;
 * a plain `coach` does NOT. (nutrition_admin is included for completeness —
 * it holds no console permission yet, but the hub still lists it as staff.)
 */
export function canOpenAdminConsole(role: string | null): boolean {
  return (
    isTopAdmin(role) ||
    role === 'member_admin' ||
    role === 'content_admin' ||
    role === 'support_admin' ||
    role === 'nutrition_admin'
  );
}
