import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavItem } from '@/components/console';
import type { StaffRole } from '@/lib/auth';
import { staffFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * Staff roles allowed into the admin console at all. A `coach` is NOT one of
 * them — coaches use /coach. Anyone outside this set (no cookie, non-staff,
 * plain coach, suspended) is bounced to /admin/login.
 */
const ADMIN_ROLES: readonly StaffRole[] = [
  'super_admin',
  'main_admin',
  'member_admin',
  'content_admin',
  'support_admin',
];

/**
 * Per-section role gates mirroring lib/authz.ts roleHasPermission. A nav item
 * renders only when the signed-in role satisfies its predicate; super_admin
 * AND main_admin pass every gate (main_admin holds the full permission set —
 * its rank limits are enforced per-operation by the API routes, not here).
 * This only HIDES a link — page agents MUST re-check the same permission
 * server-side (requirePermission) as the real access control.
 */
function isTopAdmin(role: StaffRole): boolean {
  return role === 'super_admin' || role === 'main_admin';
}
function canMembers(role: StaffRole): boolean {
  return isTopAdmin(role) || role === 'member_admin' || role === 'support_admin';
}
function canCoaches(role: StaffRole): boolean {
  return isTopAdmin(role) || role === 'member_admin';
}
function canContent(role: StaffRole): boolean {
  return isTopAdmin(role) || role === 'content_admin';
}
function canSubscriptions(role: StaffRole): boolean {
  return isTopAdmin(role) || role === 'member_admin';
}
/** Mirrors the 'coach.application.review' grant (super/main + member_admin). */
function canApplications(role: StaffRole): boolean {
  return isTopAdmin(role) || role === 'member_admin';
}
/** Mirrors the 'payments.review' grant (super/main + member_admin). */
function canPayments(role: StaffRole): boolean {
  return isTopAdmin(role) || role === 'member_admin';
}
/** Mirrors the 'support.thread.read' grant (super/main + support_admin). */
function canSupport(role: StaffRole): boolean {
  return isTopAdmin(role) || role === 'support_admin';
}
/** Mirrors the 'promo.manage' grant — super/main ONLY. */
function canPromos(role: StaffRole): boolean {
  return isTopAdmin(role);
}
/** Mirrors the 'wallet.manage' grant — super/main ONLY. */
function canWallets(role: StaffRole): boolean {
  return isTopAdmin(role);
}
/** Mirrors the 'pricing.manage' grant — super/main ONLY. */
function canPricing(role: StaffRole): boolean {
  return isTopAdmin(role);
}
function canStaff(role: StaffRole): boolean {
  return isTopAdmin(role);
}
function canAudit(role: StaffRole): boolean {
  return isTopAdmin(role);
}

/** Builds the visible nav for a role. Overview is always present. */
function navFor(role: StaffRole): NavItem[] {
  const items: NavItem[] = [{ href: '/admin', label: 'Overview', match: 'exact' }];
  if (canMembers(role)) items.push({ href: '/admin/members', label: 'Members' });
  if (canCoaches(role)) items.push({ href: '/admin/coaches', label: 'Coaches' });
  if (canApplications(role))
    items.push({ href: '/admin/applications', label: 'Applications' });
  if (canContent(role)) items.push({ href: '/admin/content', label: 'Content' });
  if (canSubscriptions(role))
    items.push({ href: '/admin/subscriptions', label: 'Subscriptions' });
  if (canPayments(role)) items.push({ href: '/admin/payments', label: 'Payments' });
  if (canSupport(role)) items.push({ href: '/admin/support', label: 'Support' });
  if (canPromos(role)) items.push({ href: '/admin/promos', label: 'Promos' });
  if (canWallets(role)) items.push({ href: '/admin/wallets', label: 'Wallets' });
  if (canPricing(role)) items.push({ href: '/admin/pricing', label: 'Pricing' });
  if (canStaff(role)) items.push({ href: '/admin/staff', label: 'Staff' });
  if (canAudit(role)) items.push({ href: '/admin/audit', label: 'Audit' });
  return items;
}

/**
 * Server-component guard for the whole admin console. Resolves the 'gt_staff'
 * cookie to a Principal; only the ADMIN_ROLES set may enter.
 *
 * `/admin/login` is nested under this same layout, so guarding blindly would
 * loop (unauthenticated visitor → redirect to login → guard → redirect …). We
 * read the request pathname from `x-pathname` (set by middleware.ts); when it
 * is the login route we render children WITHOUT the shell so the login form is
 * reachable unauthenticated. Mirrors coach/layout.tsx.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';
  const isLoginRoute = pathname.startsWith('/admin/login');

  const principal = await staffFromCookie();
  const isAdmin = principal ? ADMIN_ROLES.includes(principal.role) : false;

  // Login route: never guard, never show the shell (its page owns its own UI).
  if (isLoginRoute) return <>{children}</>;

  if (!principal || !isAdmin) redirect('/admin/login');

  return (
    <ConsoleShell
      brand="Admin Console"
      nav={navFor(principal.role)}
      pathname={pathname}
      email={principal.email}
      loginHref="/admin/login"
    >
      {children}
    </ConsoleShell>
  );
}
