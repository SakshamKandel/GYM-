import { accounts, admins, coachAssignments, coachProfiles } from '@gym/db';
import { eq, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — the pool of coaches an admin can assign clients to.
 *
 *  - GET → every account with an `admins` row where role='coach', joined to
 *          coach_profiles for the public display name / accepting-clients flag,
 *          each carrying `activeClients` (count of ACTIVE coach_assignments rows
 *          where coachId = that coach). Drives the assignment UI's coach picker.
 *
 * Guarded by requirePermission('coach.assign'); super_admin passes too.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.assign');
  if (principal instanceof Response) return principal;

  const db = getDb();

  // Correlated count of this coach's ACTIVE assignments. Kept as a subquery so
  // the list stays one round-trip and each row carries its own client count.
  const activeClients = sql<number>`(
    select count(*)::int
    from ${coachAssignments}
    where ${coachAssignments.coachId} = ${accounts.id}
      and ${coachAssignments.status} = 'active'
  )`;

  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      coachName: coachProfiles.displayName,
      acceptingClients: coachProfiles.acceptingClients,
      isActive: coachProfiles.isActive,
      activeClients,
    })
    .from(admins)
    .innerJoin(accounts, eq(admins.accountId, accounts.id))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(eq(admins.role, 'coach'))
    .orderBy(accounts.displayName);

  return json({ coaches: rows }, 200);
}
