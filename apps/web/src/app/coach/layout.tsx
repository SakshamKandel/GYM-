import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavGroup } from '@/components/console';
import { staffFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * Coach console nav, grouped onto the same redesign shell as the admin console
 * so both consoles flip with the tokens. Fixed for every coach (and
 * super_admin / main_admin, who may view it). Coach routes re-check their guards
 * server-side per route, so this grouping is presentational only.
 */
const COACH_NAV: NavGroup[] = [
  {
    label: 'Coaching',
    items: [
      { href: '/coach', label: 'Inbox', match: 'exact' },
      { href: '/coach/clients', label: 'Clients' },
      { href: '/coach/attention', label: 'Attention' },
      { href: '/coach/review', label: 'Review' },
    ],
  },
  {
    label: 'Programs',
    items: [
      { href: '/coach/verify', label: 'Verify' },
      { href: '/coach/flags', label: 'Flags' },
      { href: '/coach/challenges', label: 'Challenges' },
      { href: '/coach/videos', label: 'Videos' },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/coach/wallet', label: 'Wallet' },
      { href: '/coach/profile', label: 'Profile' },
    ],
  },
];

/**
 * Server-component guard for the whole coach console. Resolves the 'gt_staff'
 * cookie to a Principal; only 'coach', 'super_admin' and 'main_admin' may enter.
 * A `partner`-role principal is bounced to its own console before the coach
 * check. Anyone else (no cookie, non-staff, wrong role, suspended) is redirected
 * to the login page.
 *
 * `/coach/login` is nested under this same layout, so guarding blindly would
 * loop; we read the request pathname from `x-pathname` (set by middleware.ts)
 * and render the login route WITHOUT the shell.
 */
export default async function CoachLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';
  const isLoginRoute = pathname.startsWith('/coach/login');

  const principal = await staffFromCookie();
  const isCoach =
    principal?.role === 'coach' ||
    principal?.role === 'super_admin' ||
    principal?.role === 'main_admin';

  // Login route: never guard, never show the shell (its page owns its own UI).
  if (isLoginRoute) return <>{children}</>;

  if (!principal) redirect('/coach/login');
  if (principal.role === 'partner') redirect('/partner');
  if (!isCoach) redirect('/coach/login');

  return (
    <ConsoleShell
      brand="Coach Console"
      groups={COACH_NAV}
      pathname={pathname}
      email={principal.email}
      loginHref="/coach/login"
    >
      {children}
    </ConsoleShell>
  );
}
