import { accounts, admins, coachProfiles } from '@gym/db';
import { asc, eq, ne } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { type StaffMember, StaffManager } from './_components/StaffManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Staff & roles — super_admin + main_admin. Lists every account carrying an
 * `admins` row and lets the operator grant, change, or revoke a staff role
 * without ever touching SQL. What the caller may TARGET is rank-limited: the
 * client greys out rows per canManageRole (main_admin manages sub-roles only)
 * and the mutation routes re-check the same rank rules server-side. The layout
 * already hides the nav link, but we re-check here so hitting the URL directly
 * still fails safe (the admin layout comment explicitly requires each page to
 * re-check its role set), and every mutation route re-checks 'roles.grant'
 * independently.
 */

/**
 * Loads the current staff roster via getDb. Shape matches GET /api/admin/staff
 * so the initial server render and any later client refetch agree. LEFT JOIN to
 * coach_profiles so a coach's public display name shows where present without
 * dropping non-coach staff.
 */
async function loadStaff(): Promise<StaffMember[]> {
  const db = getDb();
  const rows = await db
    .select({
      accountId: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      status: accounts.status,
      role: admins.role,
      coachName: coachProfiles.displayName,
    })
    .from(admins)
    .innerJoin(accounts, eq(accounts.id, admins.accountId))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    // Partner (rank-0 restaurant operator) is a web-only delivery role minted
    // via /api/admin/partners, never a staff grant — it has no place in the
    // staff & roles roster, and surfacing it here would invite an accidental
    // re-role (the grant path can't target it anyway). Keep it out entirely.
    .where(ne(admins.role, 'partner'))
    .orderBy(asc(accounts.email));

  return rows.map((r) => ({
    accountId: r.accountId,
    email: r.email,
    displayName: r.displayName,
    status: r.status,
    role: r.role,
    coachName: r.coachName ?? null,
  }));
}

export default async function AdminStaffPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('roles.grant')) redirect('/admin');

  const staff = await loadStaff();

  return (
    <StaffManager
      staff={staff}
      currentAccountId={principal.id}
      callerRole={principal.role}
    />
  );
}
