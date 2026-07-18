import type { StaffRole } from '@gym/shared';

/**
 * Human labels for the 7-role staff hierarchy — the single place a role name
 * is turned into UI copy (hub greeting, staff rows, member detail sheets).
 * Role LOGIC (rank, who manages whom) stays in @gym/shared/staffRoles; this
 * file is display-only.
 */
export const ROLE_LABEL: Record<StaffRole, string> = {
  super_admin: 'Super admin',
  main_admin: 'Main admin',
  member_admin: 'Member admin',
  nutrition_admin: 'Nutrition admin',
  content_admin: 'Content admin',
  support_admin: 'Support admin',
  coach: 'Coach',
  partner: 'Meal partner',
};

/** Label for a role, with a safe generic fallback for null/unknown. */
export function roleLabel(role: StaffRole | null | undefined): string {
  return role ? ROLE_LABEL[role] : 'Staff';
}
