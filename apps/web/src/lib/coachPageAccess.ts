import type { Permission, StaffRole } from '@gym/shared';

/** A single required capability, or an OR-list for shared console surfaces. */
export type CoachPageRequirement = Permission | readonly Permission[];

/** Only coaches and the two unstrippable top-admin roles may enter this console. */
export function isCoachConsoleRole(role: StaffRole): boolean {
  return role === 'coach' || role === 'super_admin' || role === 'main_admin';
}

/**
 * Pure authorization decision used by the SSR guard and its tests. Arrays are
 * OR-lists (for example, the video library accepts org-wide or own-video
 * management). Top admins retain the same safety-floor bypass as API guards.
 */
export function canAccessCoachPage(
  role: StaffRole,
  permissions: ReadonlySet<Permission>,
  required: CoachPageRequirement,
): boolean {
  if (!isCoachConsoleRole(role)) return false;
  if (role === 'super_admin' || role === 'main_admin') return true;

  const requiredPermissions = typeof required === 'string' ? [required] : required;
  return requiredPermissions.some((permission) => permissions.has(permission));
}

