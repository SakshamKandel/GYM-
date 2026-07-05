import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavItem } from '@/components/console';
import { staffFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * Coach console nav. Fixed for every coach (and super_admin / main_admin, who
 * may view it):
 * Inbox (message threads), Clients (assigned users), Videos (form-check library
 * — coach holds content.video.publish), Profile (public coach card). Page agents
 * re-check the coach guards server-side per route.
 */
const COACH_NAV: NavItem[] = [
  { href: '/coach', label: 'Inbox', match: 'exact' },
  { href: '/coach/clients', label: 'Clients' },
  { href: '/coach/attention', label: 'Attention' },
  { href: '/coach/review', label: 'Review' },
  { href: '/coach/videos', label: 'Videos' },
  { href: '/coach/profile', label: 'Profile' },
];

/**
 * Server-component guard for the whole coach console. Resolves the 'gt_staff'
 * cookie to a Principal; only 'coach', 'super_admin' and 'main_admin' may
 * enter. Anyone else
 * (no cookie, non-staff, wrong role, suspended) is redirected to the login
 * page.
 *
 * `/coach/login` is nested under this same layout, so guarding blindly would
 * loop (unauthenticated visitor → redirect to login → guard → redirect …). We
 * read the request pathname from `x-pathname` (set by middleware.ts); when it
 * is the login route we render children WITHOUT the shell so the login form is
 * reachable unauthenticated.
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

  if (!principal || !isCoach) redirect('/coach/login');

  return (
    <ConsoleShell
      brand="Coach Console"
      nav={COACH_NAV}
      pathname={pathname}
      email={principal.email}
      loginHref="/coach/login"
    >
      {children}
    </ConsoleShell>
  );
}
