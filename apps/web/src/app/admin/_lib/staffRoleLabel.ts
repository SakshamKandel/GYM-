import type { StaffRole } from '@gym/shared';

/**
 * Human-readable labels for staff roles, shared by the admin console screens
 * (staff manager, member directory, member drawer). Display copy ONLY — rank
 * rules live in @gym/shared (staffRoles.ts) and are enforced by the API.
 * Underscore-prefixed folder, so Next never treats this as a route.
 */
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: 'Super admin',
  main_admin: 'Main admin',
  member_admin: 'Member admin',
  nutrition_admin: 'Nutrition admin',
  content_admin: 'Content admin',
  support_admin: 'Support admin',
  coach: 'Coach',
  partner: 'Meal partner',
};

export function staffRoleLabel(role: StaffRole): string {
  return STAFF_ROLE_LABELS[role];
}
