import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { ConsoleShell, type NavGroup } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import {
  canAccessCoachPage,
  type CoachPageRequirement,
} from '@/lib/coachPageAccess';

export const runtime = 'nodejs';
export const metadata: Metadata = { robots: { index: false, follow: false } };
// Guard reads cookies, so this subtree is always dynamic.
export const dynamic = 'force-dynamic';

/**
 * Coach console nav, grouped onto the same redesign shell as the admin console
 * so both consoles flip with the tokens. Each item carries the same capability
 * its server page enforces; explicit per-account denies therefore remove the
 * link as well as blocking direct navigation.
 */
interface CoachNavItem {
  href: string;
  label: string;
  match?: 'exact';
  required: CoachPageRequirement;
}

const COACH_NAV: { label: string; items: CoachNavItem[] }[] = [
  {
    label: 'Coaching',
    items: [
      { href: '/coach', label: 'Inbox', match: 'exact', required: 'coach.user.read' },
      { href: '/coach/clients', label: 'Clients', required: 'coach.user.read' },
      { href: '/coach/attention', label: 'Attention', required: 'coach.user.read' },
      { href: '/coach/review', label: 'Review', required: 'coach.user.read' },
    ],
  },
  {
    label: 'Programs',
    items: [
      { href: '/coach/verify', label: 'Verify', required: 'coach.user.read' },
      { href: '/coach/flags', label: 'Flags', required: 'coach.user.read' },
      { href: '/coach/challenges', label: 'Challenges', required: 'coach.user.read' },
      {
        href: '/coach/videos',
        label: 'Videos',
        required: ['content.manage', 'content.video.own'],
      },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/coach/wallet', label: 'Wallet', required: 'coach.wallet.read' },
      { href: '/coach/profile', label: 'Profile', required: 'coach.user.read' },
    ],
  },
];

const COACH_ENTRY_PERMISSIONS = [
  'coach.user.read',
  'coach.wallet.read',
  'content.manage',
  'content.video.own',
] as const;

function navFor(
  role: Parameters<typeof canAccessCoachPage>[0],
  permissions: Parameters<typeof canAccessCoachPage>[1],
): NavGroup[] {
  return COACH_NAV.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => canAccessCoachPage(role, permissions, item.required))
      .map(({ required: _required, ...item }) => item),
  })).filter((group) => group.items.length > 0);
}

/**
 * Server-component guard for the whole coach console. The shared guard resolves
 * identity plus effective allow/deny overrides and requires at least one visible
 * coach-console capability. Individual pages repeat their narrower check before
 * running a protected loader.
 *
 * `/coach/login` is nested under this same layout, so guarding blindly would
 * loop; we read the request pathname from `x-pathname` (set by middleware.ts)
 * and render the login route WITHOUT the shell.
 */
export default async function CoachLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';
  const isLoginRoute = pathname.startsWith('/coach/login');

  // Login route: never guard, never show the shell (its page owns its own UI).
  if (isLoginRoute) return <>{children}</>;

  const { principal, permissions } = await requireCoachPage(COACH_ENTRY_PERMISSIONS);

  return (
    <ConsoleShell
      brand="Coach Console"
      groups={navFor(principal.role, permissions)}
      pathname={pathname}
      email={principal.email}
      loginHref="/coach/login"
    >
      {children}
    </ConsoleShell>
  );
}
