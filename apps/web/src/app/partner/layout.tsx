import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavGroup } from '@/components/console';
import { staffFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';
export const metadata: Metadata = { robots: { index: false, follow: false } };
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * Partner console nav on the same redesign shell as admin/coach — the light
 * SaaS theme flips with the shared tokens. A partner sees ONLY delivery
 * surfaces; there is no admin/coach entry anywhere in this tree, and every
 * route re-checks `requirePartner` server-side, so this grouping is purely
 * presentational.
 */
const PARTNER_NAV: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { href: '/partner', label: 'Today', match: 'exact' },
      { href: '/partner/prep', label: 'Prep Summary' },
      { href: '/partner/subscriptions', label: 'Subscriptions' },
      { href: '/partner/history', label: 'Order History' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/partner/menu', label: 'Menu' },
      { href: '/partner/store', label: 'Store Controls' },
      { href: '/partner/earnings', label: 'Earnings' },
      { href: '/partner/profile', label: 'Profile' },
    ],
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
      brand="Partner Portal"
      groups={PARTNER_NAV}
      pathname={pathname}
      email={principal.email}
      loginHref="/partner/login"
    >
      {children}
    </ConsoleShell>
  );
}
