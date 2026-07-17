import { accounts, admins, coachAssignments, coachMilestones, coachProfiles } from '@gym/db';
import { and, desc, eq, sql } from 'drizzle-orm';
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
      coachTier: coachProfiles.coachTier,
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
    // A suspended coach (accounts.status='suspended') can't log in, so their
    // public detail page must 404 too — mirrors the discovery list's status
    // filter (C3). Suspension writes only accounts.status, leaving
    // admins.role='coach' and coachProfiles.isActive untouched, so this is the
    // guard that hides a suspended coach's portfolio + request affordance.
    .where(
      and(
        eq(accounts.id, id),
        eq(admins.role, 'coach'),
        eq(coachProfiles.isActive, true),
        eq(accounts.status, 'active'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  // Anonymised social proof: coach-logged client wins, title + date only —
  // never the client's name/id (PII policy). Newest first, capped.
  const milestones = await db
    .select({
      title: coachMilestones.title,
      achievedAt: coachMilestones.achievedAt,
    })
    .from(coachMilestones)
    .where(eq(coachMilestones.coachId, row.id))
    .orderBy(desc(coachMilestones.achievedAt), desc(coachMilestones.createdAt))
    .limit(5);

  // `photoUrl` mirrors `avatarUrl` — the canonical name going forward; the
  // legacy key stays so already-shipped mobile parsers keep working.
  const coach = {
    ...row,
    displayName: row.displayName || 'Coach',
    photoUrl: row.avatarUrl,
    hasCapacity: row.activeClients < row.capacity,
    milestones,
  };

  return json({ coach }, 200);
}
