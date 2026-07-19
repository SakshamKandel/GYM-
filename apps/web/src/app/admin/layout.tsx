import type { Permission } from '@gym/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavGroup } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';
export const metadata: Metadata = { robots: { index: false, follow: false } };
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * The console nav carries the permission that unlocks each item, grouped into
 * the redesign IA (Main / Operations / Growth / System). Every item is checked
 * against the same effective permission set (role preset plus account
 * overrides) enforced by the API routes. Dashboard has no `perm` because its
 * own tiles are permission-gated. Hiding a link is a courtesy only; every page
 * re-checks its permission server-side — so this filtering MUST stay
 * behaviour-preserving (never widen what a role can see).
 *
 * `orders.review`, `partners.manage`, `gyms.manage` are super/main-only
 * (delegable via override) — deliberately absent from every sub-role preset, so
 * they surface for those roles only. Orders / Partners / Meal Payments pages are
 * delivered by sibling packages; the links are permission-gated regardless.
 */
type NavSpec = {
  href: string;
  label: string;
  /** Single permission that unlocks the item. */
  perm?: Permission;
  /** OR-list: the item unlocks when the set holds ANY of these (C-C). Takes
   *  precedence over `perm` when present. */
  anyPerm?: readonly Permission[];
  match?: 'exact' | 'prefix';
  badge?: number;
};

const NAV_GROUPS: { label: string; items: NavSpec[] }[] = [
  {
    label: 'Main menu',
    items: [
      { href: '/admin', label: 'Dashboard', match: 'exact' },
      { href: '/admin/members', label: 'Members', perm: 'members.read' },
      { href: '/admin/coaches', label: 'Coaches', perm: 'coach.assign' },
      { href: '/admin/subscriptions', label: 'Subscriptions', perm: 'subscription.override' },
      { href: '/admin/analytics', label: 'Analytics', perm: 'analytics.read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/applications', label: 'Applications', perm: 'coach.application.review' },
      { href: '/admin/payments', label: 'Payments', perm: 'payments.review' },
      { href: '/admin/orders', label: 'Orders', perm: 'orders.review' },
      { href: '/admin/disputes', label: 'Disputes', perm: 'orders.review' },
      { href: '/admin/meal-payments', label: 'Meal Payments', perm: 'payments.review' },
      { href: '/admin/meal-subscriptions', label: 'Meal Subscriptions', perm: 'payments.review' },
      { href: '/admin/support', label: 'Support', perm: 'support.thread.read' },
      { href: '/admin/abuse', label: 'Abuse', perm: 'subscription.override' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { href: '/admin/pricing', label: 'Pricing', perm: 'pricing.manage' },
      { href: '/admin/promos', label: 'Promos', perm: 'promo.manage' },
      // Wallets holds both the coach-wallet ledger (wallet.manage) and the payout
      // queue (payouts.review); either scoped grant must reveal the link (C-C).
      { href: '/admin/wallets', label: 'Wallets', anyPerm: ['wallet.manage', 'payouts.review'] },
      { href: '/admin/partners', label: 'Partners', perm: 'partners.manage' },
      { href: '/admin/broadcast', label: 'Broadcast', perm: 'broadcast.send' },
      { href: '/admin/gamification', label: 'Gamification', perm: 'gamification.manage' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/content', label: 'Content', perm: 'content.manage' },
      { href: '/admin/catalog', label: 'Catalog', perm: 'catalog.manage' },
      { href: '/admin/gyms', label: 'Gyms', perm: 'gyms.manage' },
      { href: '/admin/gyms/reports', label: 'Gym Reports', perm: 'gyms.manage' },
      { href: '/admin/staff', label: 'Staff', perm: 'roles.grant' },
      { href: '/admin/audit', label: 'Audit', perm: 'audit.read' },
    ],
  },
];

/** Every gated permission in the nav — used to decide admin-console access. */
const ALL_NAV_PERMS: Permission[] = NAV_GROUPS.flatMap((g) =>
  g.items.flatMap((i) => (i.anyPerm ? [...i.anyPerm] : i.perm ? [i.perm] : [])),
);

/**
 * An item is visible when it carries no gate, OR the set holds any of its
 * `anyPerm` keys (OR-list), OR the set holds its single `perm`.
 */
function itemVisible(item: NavSpec, permissions: ReadonlySet<Permission>): boolean {
  if (item.anyPerm) return item.anyPerm.some((p) => permissions.has(p));
  if (item.perm) return permissions.has(item.perm);
  return true;
}

/** Builds the visible grouped nav from the server-resolved permission set. */
function navFor(permissions: ReadonlySet<Permission>): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => itemVisible(item, permissions))
      .map(({ href, label, match, badge }) => ({
        href,
        label,
        ...(match ? { match } : {}),
        ...(badge ? { badge } : {}),
      })),
  })).filter((group) => group.items.length > 0);
}

/**
 * Server-component guard for the whole admin console. Resolves the 'gt_staff'
 * cookie to a Principal; only staff holding at least one admin-nav permission
 * may enter. A `partner`-role principal is bounced to its own console before any
 * admin check (partner holds none of these perms and would 403 anyway — this is
 * a UX courtesy).
 *
 * `/admin/login` is nested under this same layout, so guarding blindly would
 * loop; we read the request pathname from `x-pathname` (set by middleware.ts)
 * and render the login route WITHOUT the shell.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';
  const isLoginRoute = pathname.startsWith('/admin/login');

  const principal = await staffFromCookie();
  // Login route: never guard, never show the shell (its page owns its own UI).
  if (isLoginRoute) return <>{children}</>;

  if (!principal) redirect('/admin/login');
  if (principal.role === 'partner') redirect('/partner');

  const permissions = await effectivePermissionSet(principal);
  const isAdmin = ALL_NAV_PERMS.some((perm) => permissions.has(perm));
  if (!isAdmin) redirect('/admin/login');

  const canSupport = permissions.has('support.thread.read');

  return (
    <ConsoleShell
      brand="Admin Console"
      groups={navFor(permissions)}
      pathname={pathname}
      email={principal.email}
      loginHref="/admin/login"
      notificationsHref={canSupport ? '/admin/support' : undefined}
    >
      {children}
    </ConsoleShell>
  );
}
