import { cookies } from 'next/headers';
import { staffForToken } from './auth';
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
 * Resolves the cookie to a staff Principal via staffForToken, or null. Used by
 * server components (coach/layout.tsx) to guard the console.
 */
export async function staffFromCookie(): Promise<Principal | null> {
  const token = await staffTokenFromCookie();
  if (!token) return null;
  const staff = await staffForToken(token);
  if (!staff) return null;
  return { id: staff.user.id, email: staff.user.email, role: staff.role };
}
