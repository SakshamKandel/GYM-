import type { Permission } from '@gym/shared';
import { redirect } from 'next/navigation';
import { effectivePermissionSet, type Principal } from './authz';
import {
  canAccessCoachPage,
  isCoachConsoleRole,
  type CoachPageRequirement,
} from './coachPageAccess';
import { staffFromCookie } from './staffSession';

export interface CoachPageContext {
  principal: Principal;
  permissions: ReadonlySet<Permission>;
}

/**
 * Server-component authorization boundary for coach pages. It resolves the
 * browser session, rejects non-coach roles, merges per-account allow/deny
 * overrides, and checks the page capability before any protected loader runs.
 * Override lookup errors fail closed instead of restoring role presets.
 */
export async function requireCoachPage(
  required: CoachPageRequirement,
): Promise<CoachPageContext> {
  const principal = await staffFromCookie();
  if (!principal) redirect('/coach/login');
  if (principal.role === 'partner') redirect('/partner');
  if (!isCoachConsoleRole(principal.role)) redirect('/coach/login');

  let permissions: ReadonlySet<Permission>;
  try {
    permissions = await effectivePermissionSet(principal);
  } catch (error) {
    console.error('coach page permission override lookup failed:', error);
    redirect('/coach/login');
  }

  if (!canAccessCoachPage(principal.role, permissions, required)) {
    redirect('/coach/login');
  }

  return { principal, permissions };
}

