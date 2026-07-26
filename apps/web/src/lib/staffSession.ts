import { ADMIN_CONSOLE_ROLES, COACH_CONSOLE_ROLES, type StaffRole } from '@gym/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { staffForToken, type StaffPrincipal } from './auth';
import type { Principal } from './authz';

/**
 * Web-console session cookie. Unlike the mobile app (Bearer header), the coach
 * console is a browser and carries the same opaque session token in an
 * httpOnly cookie so JS can never read it. Name is 'gt_staff'.
 */
export const STAFF_COOKIE = 'gt_staff';

const SESSION_DAYS = 30;

/** Sets the httpOnly / Secure / SameSite=Lax cookie carrying a session token. */
export async function setStaffCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(STAFF_COOKIE, token, {
    httpOnly: true,
    // Secure only in production (https). A `Secure` cookie is silently DROPPED
    // by the browser over plain http://, so forcing it in dev breaks local
    // login at http://localhost — the login POST succeeds but the cookie never
    // sticks, so the guard bounces you back to /login. Vercel is https, so prod
    // stays Secure.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Clears the staff cookie (sign out). */
export async function clearStaffCookie(): Promise<void> {
  const store = await cookies();
  store.delete(STAFF_COOKIE);
}

/** Reads the raw token from the cookie, or null. */
export async function staffTokenFromCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(STAFF_COOKIE)?.value ?? null;
}

/**
 * Per-request memo of the session lookup (a sessions ⋈ accounts ⋈ admins join).
 *
 * Rendering one console page resolves the session at least twice — the layout
 * guards the shell and the page re-guards itself — and any API route the same
 * request touches resolves it again. React's `cache` collapses those into one
 * query per request and forgets everything when the request ends, so a signed-
 * out or role-changed session is never served from a previous request.
 *
 * Keyed on the token STRING, deliberately: the whole point is that two callers
 * that never share an object still hit the same entry. `cache` compares
 * arguments by identity, so an object key would miss every single time.
 */
const staffForTokenCached = cache(
  async (token: string): Promise<StaffPrincipal | null> => staffForToken(token),
);

/**
 * Resolves the cookie to a staff Principal via staffForToken, or null. Used by
 * server components (coach/layout.tsx) to guard the console.
 */
export async function staffFromCookie(): Promise<Principal | null> {
  const token = await staffTokenFromCookie();
  if (!token) return null;
  const staff = await staffForTokenCached(token);
  if (!staff) return null;
  return { id: staff.user.id, email: staff.user.email, role: staff.role };
}

/**
 * Token → staff principal, memoized for the current request. Exported so the
 * API guards in `authz.ts` share the layout/page memo instead of re-running the
 * same join. Returns null for an unknown, expired or non-staff token exactly
 * like the uncached lookup.
 */
export async function staffPrincipalForToken(token: string): Promise<StaffPrincipal | null> {
  return staffForTokenCached(token);
}

// ── Which workspace an account belongs to ────────────────────────────────

/** The three staff workspaces, each with its own sign-in page. */
export type StaffConsole = 'admin' | 'coach' | 'partner';

/** Home route + the name we put in front of a human, per workspace. */
const CONSOLES: Record<StaffConsole, { href: string; name: string }> = {
  admin: { href: '/admin', name: 'admin console' },
  coach: { href: '/coach', name: 'coach console' },
  partner: { href: '/partner', name: 'partner portal' },
};

/** Offer order when an account can open more than one (top admins). */
const CONSOLE_ORDER: readonly StaffConsole[] = ['admin', 'coach', 'partner'];

/**
 * May `role` open `workspace`? Mirrors the three layout guards exactly:
 * /partner is partner-only, /admin takes ADMIN_CONSOLE_ROLES, /coach takes
 * COACH_CONSOLE_ROLES (coach plus the two top-admin roles).
 */
function canOpenConsole(role: StaffRole, workspace: StaffConsole): boolean {
  if (workspace === 'partner') return role === 'partner';
  const allowed = workspace === 'admin' ? ADMIN_CONSOLE_ROLES : COACH_CONSOLE_ROLES;
  return allowed.includes(role);
}

/** What a sign-in page shows instead of the form when the account is elsewhere. */
export interface ConsoleMismatch {
  title: string;
  body: string;
  action: { href: string; label: string };
}

/**
 * The wrong-workspace notice for a sign-in page, or null when there is nothing
 * to say.
 *
 * Signing in at the wrong console used to be a silent bounce: the POST
 * succeeds, the browser lands on the console, the layout guard rejects the role
 * and sends it straight back to the same empty form. Nothing on screen ever
 * said why. This resolves the session the login page can already see and, when
 * that account cannot open THIS workspace, hands back plain copy plus the place
 * it should go.
 *
 * Deliberately reads the SESSION, not the submitted email: an unauthenticated
 * visitor gets null every time, so none of this can be used to probe whether an
 * address is staff. It only ever appears after a sign-in that worked.
 */
export async function consoleMismatchFromCookie(
  workspace: StaffConsole,
): Promise<ConsoleMismatch | null> {
  const principal = await staffFromCookie();
  if (!principal) return null;
  if (canOpenConsole(principal.role, workspace)) return null;

  const here = CONSOLES[workspace].name;
  const home = CONSOLE_ORDER.find((c) => canOpenConsole(principal.role, c));

  if (!home) {
    return {
      title: `This account does not open the ${here}`,
      body: 'You are signed in, but this account has no staff workspace yet. Ask whoever set it up to give you access.',
      action: { href: '/contact', label: 'Ask for help' },
    };
  }

  const there = CONSOLES[home].name;
  return {
    title: `This account does not open the ${here}`,
    body: `You are signed in. Your work lives in the ${there}, so open that instead.`,
    action: { href: CONSOLES[home].href, label: `Go to the ${there}` },
  };
}
