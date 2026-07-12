import { coachAssignments, coachDietPlans, coachProfiles } from '@gym/db';
import { compareTiers, minTierFor } from '@gym/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member-facing — the signed-in member's active coach-assigned diet plans
 * (SCALE-UP-PLAN §4.3), rendered as the Food tab's "Coach diet plan" card.
 *
 * GET /api/me/coach-diet
 *   - Bearer auth via userForToken (suspended accounts get null → 401).
 *   - Server-side tier gate FIRST, mirrors the plan-videos pattern: compares
 *     the member's effective tier against the `coach_diet` entitlement floor
 *     (gold) via compareTiers, BEFORE touching any assignment/plan data.
 *     Locked → 403 { error:'locked', requiredTier }.
 *   - Otherwise looks up the member's newest ACTIVE coach assignment. No
 *     active coach → { plans: [], coach: null } (empty, not an error — an
 *     unassigned gold+ member is a normal state, not a lock).
 *   - With an active coach: returns every `active`-status assigned diet plan
 *     row for this member AUTHORED BY THAT SAME COACH (createdAt asc), plus
 *     the coach card ({id, displayName}). Filtering on coachId too (not just
 *     clientId) matters when the member's coach changes — a prior coach's
 *     still-active rows must not be attributed to the new one.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const requiredTier = minTierFor('coach_diet');
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
  if (!assignment) return json({ plans: [], coach: null }, 200);

  const plans = await db
    .select({
      id: coachDietPlans.id,
      title: coachDietPlans.title,
      notes: coachDietPlans.notes,
      status: coachDietPlans.status,
      meals: coachDietPlans.meals,
      createdAt: coachDietPlans.createdAt,
      updatedAt: coachDietPlans.updatedAt,
    })
    .from(coachDietPlans)
    .where(
      and(
        eq(coachDietPlans.clientId, user.id),
        eq(coachDietPlans.coachId, assignment.coachId),
        eq(coachDietPlans.status, 'active'),
      ),
    )
    .orderBy(asc(coachDietPlans.createdAt));

  return json(
    {
      plans,
      coach: { id: assignment.coachId, displayName: assignment.displayName || 'Coach' },
    },
    200,
  );
}
