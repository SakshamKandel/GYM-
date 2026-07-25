import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavGroup } from '@/components/console';
import { staffFromCookie } from '@/lib/staffSession';
import { PartnerAlerts } from './_components/PartnerAlerts';

export const runtime = 'nodejs';
export const metadata: Metadata = {
  // Every partner page exports its own short `title`; this template turns it
  // into the browser tab title, and `default` covers a page that forgets one.
  title: { default: 'Partner portal', template: '%s · Partner portal' },
  robots: { index: false, follow: false },
};
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * Partner console nav on the same redesign shell as admin/coach — the light
 * SaaS theme flips with the shared tokens. A partner sees ONLY delivery
 * surfaces; there is no admin/coach entry anywhere in this tree, and every
 * route re-checks `requirePartner` server-side, so this grouping is purely
 * presentational.
 *
 * Labels are the destination page's own title, in sentence case, so the sidebar
 * never promises a heading the page does not show. There is ONE money
 * destination: Earnings answers both "what am I owed" and "how are sales going".
 * /partner/wallet used to answer the first question on its own, with figures
 * framed differently, and now redirects here.
 */
const PARTNER_NAV: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { href: '/partner', label: 'Today', match: 'exact' },
      { href: '/partner/prep', label: 'Prep summary' },
      { href: '/partner/subscriptions', label: 'Subscriptions' },
      { href: '/partner/history', label: 'Order history' },
      { href: '/partner/verify', label: 'Verify member' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/partner/menu', label: 'Menu' },
      { href: '/partner/store', label: 'Store controls' },
      { href: '/partner/earnings', label: 'Earnings' },
      { href: '/partner/feedback', label: 'Customer feedback' },
      { href: '/partner/profile', label: 'Restaurant profile' },
    ],
  },
  {
    label: 'Help',
    items: [{ href: '/partner/support', label: 'Message the team' }],
  },
];

/**
 * Server-component guard for the whole partner console. Resolves the 'gt_staff'
 * cookie to a Principal; ONLY role === 'partner' may enter. A staff principal of
 * another role is bounced to its own console (never shown the partner shell); a
 * missing/invalid session goes to the partner login.
 *
 * `/partner/login` is nested under this layout, so guarding blindly would loop;
 * we read the pathname from `x-pathname` (set by middleware.ts) and render the
 * login route WITHOUT the shell. Per-page `requirePartnerPage` additionally
 * re-checks the partner's `isActive` flag on every load.
 */
export default async function PartnerLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';
  const isLoginRoute = pathname.startsWith('/partner/login');

  const principal = await staffFromCookie();

  // Login route: never guard, never show the shell (its page owns its own UI).
  if (isLoginRoute) return <>{children}</>;

  if (!principal) redirect('/partner/login');
  if (principal.role !== 'partner') {
    redirect(principal.role === 'coach' ? '/coach' : '/admin');
  }

  return (
    <ConsoleShell
      brand="Partner portal"
      groups={PARTNER_NAV}
      pathname={pathname}
      email={principal.email}
      loginHref="/partner/login"
    >
      {/* Bottom padding keeps the last row of every page clear of the dock. */}
      <div style={{ paddingBottom: 88 }}>{children}</div>
      {/* Mounted by the LAYOUT, not a page: a restaurant is reachable only in
          the tab it already has open, so the watch has to survive navigation
          between the board, the menu and everything else. */}
      <PartnerAlerts />
    </ConsoleShell>
  );
}
