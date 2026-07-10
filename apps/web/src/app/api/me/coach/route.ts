import { coachAssignments, coachProfiles, coachRequests } from '@gym/db';
import { and, desc, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * The signed-in member's mentorship state in one call:
 *
 *  - coach   → the NEWEST active assignment's coach card, or null when the
 *              member is unassigned.
 *  - request → the member's pending coach request (at most one exists — the
 *              POST route enforces it), or null.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = getDb();

  const assignments = await db
    .select({
      coachId: coachAssignments.coachId,
      displayName: coachProfiles.displayName,
      headline: coachProfiles.headline,
      avatarUrl: coachProfiles.avatarUrl,
    })
    .from(coachAssignments)
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachAssignments.coachId))
    .where(
      and(eq(coachAssignments.userId, user.id), eq(coachAssignments.status, 'active')),
    )
    .orderBy(desc(coachAssignments.createdAt))
    .limit(1);

  const assignment = assignments[0];
  const coach = assignment
    ? {
        id: assignment.coachId,
        displayName: assignment.displayName || 'Coach',
        headline: assignment.headline ?? '',
        avatarUrl: assignment.avatarUrl ?? null,
      }
    : null;

  const pendings = await db
    .select({
      id: coachRequests.id,
      coachId: coachRequests.coachId,
      coachName: coachProfiles.displayName,
      createdAt: coachRequests.createdAt,
    })
    .from(coachRequests)
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachRequests.coachId))
    .where(and(eq(coachRequests.userId, user.id), eq(coachRequests.status, 'pending')))
    .orderBy(desc(coachRequests.createdAt))
    .limit(1);

  const pending = pendings[0];
  const request = pending
    ? {
        id: pending.id,
        coachId: pending.coachId,
        coachName: pending.coachName || 'Coach',
        status: 'pending' as const,
        createdAt: pending.createdAt,
      }
    : null;

  return json({ coach, request }, 200);
}
