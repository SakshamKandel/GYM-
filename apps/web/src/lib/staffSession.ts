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
