import { accounts, admins, coachAssignments, coachProfiles } from '@gym/db';
import { and, eq, sql } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member-facing coach detail page — the full public portfolio (bio,
 * certifications, achievements, reply window) for one ACTIVE coach. 404 for
 * anything that isn't an active coach so member clients can't probe accounts.
 * Email is deliberately never selected.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;

  const db = getDb();

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
      bio: coachProfiles.bio,
      certifications: coachProfiles.certifications,
      achievements: coachProfiles.achievements,
      replyWindowHours: coachProfiles.replyWindowHours,
      capacity: coachProfiles.capacity,
      activeClients,
    })
    .from(admins)
    .innerJoin(accounts, eq(admins.accountId, accounts.id))
    .innerJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(
      and(
        eq(accounts.id, id),
        eq(admins.role, 'coach'),
        eq(coachProfiles.isActive, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  const coach = {
    ...row,
    displayName: row.displayName || 'Coach',
    hasCapacity: row.activeClients < row.capacity,
  };

  return json({ coach }, 200);
}
