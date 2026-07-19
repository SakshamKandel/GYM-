import { router, type Href } from 'expo-router';
import {
  type Permission,
} from '@gym/shared';

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
 *
 * Console visibility derives from the server-provided effective permission
 * list, so account-specific grants and denials match API enforcement.
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
  /** The coach's commission wallet ledger (promo-economy work). */
  coachWallet: '/staff/coach/wallet',
  /** One client's detail — set/extend their tier + expiry. Pass the user id. */
  coachClient: (userId: string): string => `/staff/coach/client/${userId}`,
  /** The attention queue — assigned clients sorted stalest-first (coach.user.read). */
  coachAttention: '/staff/coach/attention',
  /** Progression review queue — approve/adjust suggestions (coach.user.read). */
  coachReview: '/staff/coach/review',
  /** Strength-badge verification queue (coach.user.read). */
  coachVerify: '/staff/coach/verify',
  /** Flagged (unranked) workouts — acknowledge/restore (coach.user.read). */
  coachFlags: '/staff/coach/flags',
  /** The coach's own monthly challenge + client progress (coach.user.read). */
  coachChallenges: '/staff/coach/challenges',

  // ── Admin area ──────────────────────────────────────────────
  /** Admin console home — the overview dashboard. */
  adminHome: '/staff/admin',
  /** Member directory. */
  adminMembers: '/staff/admin/members',
  /** Coach pool + assignment management. */
  adminCoaches: '/staff/admin/coaches',
  /** Plan-video library (screen file: staff/admin/content.tsx). */
  adminVideos: '/staff/admin/content',
  /** Tier overrides + recent-override history (screen file: subscriptions.tsx). */
  adminSubscriptions: '/staff/admin/subscriptions',
  /** Coach application review queue (member_admin + super/main). */
  adminApplications: '/staff/admin/applications',
  /** Nepal manual-payment review queue (member_admin + super/main). */
  adminPayments: '/staff/admin/payments',
  /** Promo code management (super_admin + main_admin only). */
  adminPromos: '/staff/admin/promos',
  /** Support inbox (support_admin + super/main). */
  adminSupport: '/staff/admin/support',
  /** Staff & roles management (super_admin + main_admin). */
  adminStaff: '/staff/admin/staff',
  /** Audit trail (super_admin + main_admin). */
  adminAudit: '/staff/admin/audit',
  /** Regional tier-price grid (pricing.manage — super/main). */
  adminPricing: '/staff/admin/pricing',
  /** Coach wallet balances + ledger + adjustments (wallet.manage — super/main). */
  adminWallets: '/staff/admin/wallets',
  /** Coach seniority tier-request queue (coach.application.review). */
  adminTierRequests: '/staff/admin/tier-requests',
  /** Coach payout-request review queue (payouts.review — super/main). */
  adminPayouts: '/staff/admin/payouts',
  /** All-partners meal-order oversight (orders.review — super/main). */
  adminOrders: '/staff/admin/orders',
  /** Meal-delivery manual-payment review queue (payments.review). */
  adminMealPayments: '/staff/admin/meal-payments',
  /** Platform analytics dashboard (analytics.read — super/main). */
  adminAnalytics: '/staff/admin/analytics',
  /** Push broadcast composer + send history (broadcast.send — super/main). */
  adminBroadcast: '/staff/admin/broadcast',
  /** Gamification oversight — XP corrections, badge revoke, challenge moderation (gamification.manage). */
  adminGamification: '/staff/admin/gamification',
  /** Exercise + training-plan catalog authoring (catalog.manage). */
  adminCatalog: '/staff/admin/catalog',
  /** Member-content moderation queues — milestones + progress photos (moderation.manage). */
  adminModeration: '/staff/admin/moderation',
  /** Meal-partner (restaurant) roster CRUD (partners.manage — super/main). */
  adminPartners: '/staff/admin/partners',
  /** Nearby-gyms directory CRUD (gyms.manage — super/main). */
  adminGyms: '/staff/admin/gyms',
  /** Referral/trial abuse dashboard + trial reset (subscription.override). */
  adminAbuse: '/staff/admin/abuse',
  /** Per-account permission override editor (permissions.override — super/main). */
  adminPermissions: '/staff/admin/permissions',
} as const;

/** router.push through the typed-routes escape hatch. */
export function pushStaff(path: string): void {
  router.push(path as Href);
}

/** router.replace through the typed-routes escape hatch. */
export function replaceStaff(path: string): void {
  router.replace(path as Href);
}

// ── Effective-permission visibility helpers ──────────────────

/**
 * Does the server-provided effective list hold `perm`? Missing state fails
 * closed while account-specific grants and denials remain authoritative.
 */
export function staffCan(
  permissions: readonly Permission[] | null | undefined,
  perm: Permission,
): boolean {
  return permissions?.includes(perm) ?? false;
}

/**
 * Opens the coach console when at least one coach capability is granted.
 */
const COACH_CONSOLE_PERMISSIONS: readonly Permission[] = [
  'coach.message.user',
  'coach.user.read',
  'content.video.own',
  'coach.wallet.read',
];

export function canOpenCoachConsole(permissions: readonly Permission[]): boolean {
  return COACH_CONSOLE_PERMISSIONS.some((permission) => permissions.includes(permission));
}

/**
 * Opens the admin console when at least one admin capability is granted.
 */
const ADMIN_CONSOLE_PERMISSIONS: readonly Permission[] = [
  'members.read',
  'members.suspend',
  'coach.assign',
  'subscription.override',
  'audit.read',
  'roles.grant',
  'support.thread.read',
  'support.thread.reply',
  'coach.application.review',
  'payments.review',
  'promo.manage',
  'pricing.manage',
  'wallet.manage',
  'content.manage',
  'broadcast.send',
  'members.manage_credentials',
  'payouts.review',
  'analytics.read',
  'permissions.override',
  'moderation.manage',
  'catalog.manage',
  'gamification.manage',
  'orders.review',
  'partners.manage',
  'gyms.manage',
];

export function canOpenAdminConsole(permissions: readonly Permission[]): boolean {
  return ADMIN_CONSOLE_PERMISSIONS.some((permission) => permissions.includes(permission));
}

/**
 * Coach applications + coach tier-request review: the `coach.application.review`
 * permission (member_admin; super/main bypass).
 */
export function canReviewApplications(permissions: readonly Permission[]): boolean {
  return staffCan(permissions, 'coach.application.review');
}

/** Nepal manual-payment review — the `payments.review` permission. */
export function canReviewPayments(permissions: readonly Permission[]): boolean {
  return staffCan(permissions, 'payments.review');
}

/** Promo code management — the `promo.manage` permission (super/main). */
export function canManagePromos(permissions: readonly Permission[]): boolean {
  return staffCan(permissions, 'promo.manage');
}

/** Regional pricing grid — the `pricing.manage` permission (super/main). */
export function canManagePricing(permissions: readonly Permission[]): boolean {
  return staffCan(permissions, 'pricing.manage');
}

/** Coach wallet balances/adjustments — the `wallet.manage` permission (super/main). */
export function canManageWallets(permissions: readonly Permission[]): boolean {
  return staffCan(permissions, 'wallet.manage');
}

/** Support inbox — the `support.thread.read` permission (support_admin + super/main). */
export function canReviewSupport(permissions: readonly Permission[]): boolean {
  return staffCan(permissions, 'support.thread.read');
}

/** Coach payout-request queue — the `payouts.review` permission (super/main). */
export function canManagePayouts(permissions: readonly Permission[]): boolean {
  return staffCan(permissions, 'payouts.review');
}

/**
 * All-partners meal-order oversight — the `orders.review` permission
 * (super_admin/main_admin — no sub-role preset).
 */
export function canReviewOrders(permissions: readonly Permission[]): boolean {
  return staffCan(permissions, 'orders.review');
}
