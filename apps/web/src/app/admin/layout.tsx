import type { Permission } from '@gym/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavItem } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * The console nav carries the permission that unlocks each item. It is checked
 * against the same effective permission set (role preset plus account
 * overrides) enforced by the API routes. Overview has no `perm` because its
 * own tiles are permission-gated. Hiding a link is a courtesy only; every page
 * re-checks its permission server-side.
 */
const NAV_ITEMS: { href: string; label: string; perm?: Permission; match?: 'exact' }[] = [
  { href: '/admin', label: 'Overview', match: 'exact' },
  { href: '/admin/members', label: 'Members', perm: 'members.read' },
  { href: '/admin/coaches', label: 'Coaches', perm: 'coach.assign' },
  { href: '/admin/applications', label: 'Applications', perm: 'coach.application.review' },
  { href: '/admin/content', label: 'Content', perm: 'content.manage' },
  { href: '/admin/subscriptions', label: 'Subscriptions', perm: 'subscription.override' },
  { href: '/admin/payments', label: 'Payments', perm: 'payments.review' },
  { href: '/admin/support', label: 'Support', perm: 'support.thread.read' },
  { href: '/admin/promos', label: 'Promos', perm: 'promo.manage' },
  { href: '/admin/wallets', label: 'Wallets', perm: 'wallet.manage' },
  { href: '/admin/pricing', label: 'Pricing', perm: 'pricing.manage' },
  { href: '/admin/broadcast', label: 'Broadcast', perm: 'broadcast.send' },
  { href: '/admin/staff', label: 'Staff', perm: 'roles.grant' },
  { href: '/admin/audit', label: 'Audit', perm: 'audit.read' },
];

/** Builds the visible nav from the server-resolved effective permission set. */
function navFor(permissions: ReadonlySet<Permission>): NavItem[] {
  return NAV_ITEMS.filter((item) => item.perm == null || permissions.has(item.perm)).map(
    ({ href, label, match }) => ({ href, label, ...(match ? { match } : {}) }),
  );
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
  // Login route: never guard, never show the shell (its page owns its own UI).
  if (isLoginRoute) return <>{children}</>;

  if (!principal) redirect('/admin/login');

  const permissions = await effectivePermissionSet(principal);
  const isAdmin = NAV_ITEMS.some(
    (item) => item.perm !== undefined && permissions.has(item.perm),
  );
  if (!isAdmin) redirect('/admin/login');

  return (
    <ConsoleShell
      brand="Admin Console"
      nav={navFor(permissions)}
      pathname={pathname}
      email={principal.email}
      loginHref="/admin/login"
    >
      {children}
    </ConsoleShell>
  );
}
