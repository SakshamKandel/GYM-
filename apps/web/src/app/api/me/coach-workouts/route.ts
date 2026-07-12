import { coachAssignedWorkouts, coachAssignments, coachProfiles } from '@gym/db';
import { compareTiers, minTierFor } from '@gym/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member-facing — the signed-in member's active coach-assigned workouts
 * (SCALE-UP-PLAN §4.3), rendered as the Train tab's "From your coach" section.
 *
 * GET /api/me/coach-workouts
 *   - Bearer auth via userForToken (suspended accounts get null → 401).
 *   - Server-side tier gate FIRST, mirrors the plan-videos pattern: compares
 *     the member's effective tier against the `coach_workouts` entitlement
 *     floor (silver) via compareTiers, BEFORE touching any assignment/plan
 *     data. Locked → 403 { error:'locked', requiredTier }.
 *   - Otherwise looks up the member's newest ACTIVE coach assignment. No
 *     active coach → { workouts: [], coach: null } (empty, not an error — an
 *     unassigned silver+ member is a normal state, not a lock).
 *   - With an active coach: returns every `active`-status assigned workout
 *     row for this member AUTHORED BY THAT SAME COACH (position asc, then
 *     createdAt asc), plus the coach card ({id, displayName}). Filtering on
 *     coachId too (not just clientId) matters when the member's coach
 *     changes — a prior coach's still-active rows must not be attributed to
 *     the new one.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const requiredTier = minTierFor('coach_workouts');
  if (compareTiers(user.tier, requiredTier) < 0) {
    return json({ error: 'locked', requiredTier }, 403);
  }

  const db = getDb();

  const assignments = await db
    .select({ coachId: coachAssignments.coachId, displayName: coachProfiles.displayName })
    .from(coachAssignments)
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachAssignments.coachId))
    .where(and(eq(coachAssignments.userId, user.id), eq(coachAssignments.status, 'active')))
    .orderBy(desc(coachAssignments.createdAt))
    .limit(1);

  const assignment = assignments[0];
  if (!assignment) return json({ workouts: [], coach: null }, 200);

  const workouts = await db
    .select({
      id: coachAssignedWorkouts.id,
      title: coachAssignedWorkouts.title,
      notes: coachAssignedWorkouts.notes,
      position: coachAssignedWorkouts.position,
      status: coachAssignedWorkouts.status,
      items: coachAssignedWorkouts.items,
      createdAt: coachAssignedWorkouts.createdAt,
      updatedAt: coachAssignedWorkouts.updatedAt,
    })
    .from(coachAssignedWorkouts)
    .where(
      and(
        eq(coachAssignedWorkouts.clientId, user.id),
        eq(coachAssignedWorkouts.coachId, assignment.coachId),
        eq(coachAssignedWorkouts.status, 'active'),
      ),
    )
    .orderBy(asc(coachAssignedWorkouts.position), asc(coachAssignedWorkouts.createdAt));

  return json(
    {
      workouts,
      coach: { id: assignment.coachId, displayName: assignment.displayName || 'Coach' },
    },
    200,
  );
}
