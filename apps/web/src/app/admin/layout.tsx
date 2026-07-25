import type { Permission } from '@gym/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavGroup } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { countUnreadSupportThreadsCached } from '@/lib/supportThreads';

export const runtime = 'nodejs';
export const metadata: Metadata = {
  // Every admin page exports its own short `title`; this template turns it into
  // the browser tab title, and `default` covers any page that forgets one.
  title: { default: 'Admin console', template: '%s · Admin console' },
  robots: { index: false, follow: false },
};
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * The console nav carries the permission that unlocks each item, grouped the way
 * an operator thinks about the job: the queues worked every day first, then
 * people, money, orders, content and system. Every item is checked against the
 * same effective permission set (role preset plus account overrides) enforced by
 * the API routes. Overview has no `perm` because its own tiles are
 * permission-gated. Hiding a link is a courtesy only; every page re-checks its
 * permission server-side — so this filtering MUST stay behaviour-preserving
 * (never widen what a role can see).
 *
 * Labels are the destination page's own title, in sentence case, so the sidebar
 * never promises a heading the page does not show.
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

const NAV_GROUPS: { label?: string; items: NavSpec[] }[] = [
  {
    // Unlabelled: the console's front door sits above the group structure.
    items: [{ href: '/admin', label: 'Overview', match: 'exact' }],
  },
  {
    // The queues staff clear every day. These used to sit halfway down a flat
    // 27-item list, below the fold on a laptop.
    label: 'Today',
    items: [
      { href: '/admin/support', label: 'Support', perm: 'support.thread.read' },
      { href: '/admin/applications', label: 'Coach applications', perm: 'coach.application.review' },
      { href: '/admin/payments', label: 'Membership payments', perm: 'payments.review' },
      { href: '/admin/meal-payments', label: 'Meal payments', perm: 'payments.review' },
      { href: '/admin/disputes', label: 'Disputes', perm: 'orders.review' },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/admin/members', label: 'Members', perm: 'members.read' },
      { href: '/admin/coaches', label: 'Coaches', perm: 'coach.assign' },
      { href: '/admin/staff', label: 'Staff & roles', perm: 'roles.grant' },
      { href: '/admin/abuse', label: 'Referral & trial abuse', perm: 'subscription.override' },
      { href: '/admin/broadcast', label: 'Broadcast', perm: 'broadcast.send' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/admin/subscriptions', label: 'Subscriptions', perm: 'subscription.override' },
      { href: '/admin/pricing', label: 'Pricing', perm: 'pricing.manage' },
      { href: '/admin/promos', label: 'Promo codes', perm: 'promo.manage' },
      // Coach wallets holds both the wallet ledger (wallet.manage) and the payout
      // queue (payouts.review); either scoped grant must reveal the link (C-C).
      { href: '/admin/wallets', label: 'Coach wallets', anyPerm: ['wallet.manage', 'payouts.review'] },
      // One delivery day's takings per partner kitchen — same gate as the route
      // it reads (GET /api/admin/reconciliation → 'partners.manage').
      { href: '/admin/reconciliation', label: 'Daily partner totals', perm: 'partners.manage' },
      { href: '/admin/analytics', label: 'Analytics', perm: 'analytics.read' },
    ],
  },
  {
    label: 'Orders',
    items: [
      { href: '/admin/orders', label: 'Meal orders', perm: 'orders.review' },
      { href: '/admin/meal-subscriptions', label: 'Meal subscriptions', perm: 'payments.review' },
      { href: '/admin/partners', label: 'Meal partners', perm: 'partners.manage' },
    ],
  },
  {
    label: 'Content',
    items: [
      // Content holds BOTH the plan-video library (content.manage) and the
      // moderation queues (moderation.manage) — /admin/content admits either.
      // The OR-list matters beyond tidiness: ALL_NAV_PERMS below is the console
      // entry gate, so while moderation.manage appeared in no nav item an
      // account holding only that key (e.g. a stripped-down content_admin, or a
      // per-account override grant) was bounced straight back to /admin/login
      // in a loop despite the page itself accepting it.
      { href: '/admin/content', label: 'Content', anyPerm: ['content.manage', 'moderation.manage'] },
      { href: '/admin/catalog', label: 'Exercises & plans', perm: 'catalog.manage' },
      { href: '/admin/gyms', label: 'Nearby gyms', perm: 'gyms.manage' },
      { href: '/admin/gyms/reports', label: 'Gym reports & reviews', perm: 'gyms.manage' },
      { href: '/admin/gamification', label: 'Points & badges', perm: 'gamification.manage' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/system', label: 'System health', perm: 'analytics.read' },
      { href: '/admin/audit', label: 'Audit log', perm: 'audit.read' },
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

/**
 * The single item the current route belongs to: the LONGEST href the pathname
 * sits under. The sidebar highlights any non-'exact' item whose href is a prefix
 * of the pathname, so /admin/gyms and /admin/gyms/reports both lit up on the
 * reports route. Resolving the winner here and pinning every other item to
 * 'exact' (a match only the winner can satisfy) leaves exactly one highlight.
 *
 * Returns null when nothing matches — e.g. a detail route with no nav entry, or
 * a missing `x-pathname` — in which case the declared matches are left alone.
 */
function activeHref(hrefs: readonly string[], pathname: string): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

/**
 * Builds the visible grouped nav from the server-resolved permission set.
 *
 * `badges` is a live href→count map layered over the static `badge` in the
 * spec, so counts fetched per-request (e.g. unread support threads) never have
 * to be baked into the module-level table.
 */
function navFor(
  permissions: ReadonlySet<Permission>,
  pathname: string,
  badges: Readonly<Record<string, number>> = {},
): NavGroup[] {
  const visible = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => itemVisible(item, permissions)),
  })).filter((group) => group.items.length > 0);

  const active = activeHref(
    visible.flatMap((group) => group.items.map((item) => item.href)),
    pathname,
  );

  return visible.map((group) => ({
    ...(group.label ? { label: group.label } : {}),
    items: group.items.map(({ href, label, match, badge }) => {
      const count = badges[href] ?? badge;
      const resolved = active === null ? match : href === active ? 'prefix' : 'exact';
      return {
        href,
        label,
        ...(resolved ? { match: resolved } : {}),
        ...(count ? { badge: count } : {}),
      };
    }),
  }));
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

  // Unread-support signal for the nav pill + the TopBar bell dot. Only queried
  // for viewers who can actually open the inbox. This layout wraps EVERY admin
  // page, so a transient DB hiccup must degrade to "no badge" rather than
  // erroring the whole console out from under an unrelated page — and for the
  // same reason it reads the CACHED count: a queue depth on the chrome of a
  // pricing page does not need to be recomputed for that page view (see
  // countUnreadSupportThreadsCached). /admin/support itself is always exact.
  let supportUnread = 0;
  if (canSupport) {
    try {
      supportUnread = await countUnreadSupportThreadsCached();
    } catch {
      supportUnread = 0;
    }
  }

  return (
    <ConsoleShell
      brand="Admin console"
      groups={navFor(permissions, pathname, { '/admin/support': supportUnread })}
      pathname={pathname}
      email={principal.email}
      loginHref="/admin/login"
      notificationsHref={canSupport ? '/admin/support' : undefined}
      hasNotifications={supportUnread > 0}
    >
      {children}
    </ConsoleShell>
  );
}
