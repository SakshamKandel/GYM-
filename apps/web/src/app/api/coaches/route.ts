import { accounts, admins, coachAssignments, coachProfiles } from '@gym/db';
import { and, eq, sql } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Member-facing coach discovery hub.
 *
 *  - GET → every ACTIVE coach (admins.role='coach' + coach_profiles.isActive)
 *          with their public portfolio card and live capacity signal. Coaches
 *          who can take clients (accepting AND under capacity) sort first,
 *          then by experience. Emails are deliberately never selected —
 *          coach–member contact stays inside the app.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'coaches',
    limit: 30,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const db = getDb();

  // Correlated count of this coach's ACTIVE assignments (mirrors
  // /api/admin/coaches) so the list stays one round-trip.
  const activeClients = sql<number>`(
    select count(*)::int
    from ${coachAssignments}
    where ${coachAssignments.coachId} = ${accounts.id}
      and ${coachAssignments.status} = 'active'
  )`;

  const rows = await db
    .select({
      id: accounts.id,
      displayName: coachProfiles.displayName,
      headline: coachProfiles.headline,
      avatarUrl: coachProfiles.avatarUrl,
      specialties: coachProfiles.specialties,
      yearsExperience: coachProfiles.yearsExperience,
      acceptingClients: coachProfiles.acceptingClients,
      capacity: coachProfiles.capacity,
      activeClients,
    })
    .from(admins)
    .innerJoin(accounts, eq(admins.accountId, accounts.id))
    .innerJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(and(eq(admins.role, 'coach'), eq(coachProfiles.isActive, true)));

  // capacity itself stays private on the list — members only see the boolean.
  const coaches = rows
    .map(({ capacity, ...coach }) => ({
      ...coach,
      displayName: coach.displayName || 'Coach',
      hasCapacity: coach.activeClients < capacity,
    }))
    .sort((a, b) => {
      const aOpen = a.acceptingClients && a.hasCapacity ? 1 : 0;
      const bOpen = b.acceptingClients && b.hasCapacity ? 1 : 0;
      if (aOpen !== bOpen) return bOpen - aOpen;
      return b.yearsExperience - a.yearsExperience;
    });

  return json({ coaches }, 200);
}
