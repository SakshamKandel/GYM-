import {
  accounts,
  checkIns,
  coachAssignments,
  progressionSuggestions,
  syncedWorkouts,
} from '@gym/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the attention queue: every ACTIVE client sorted by
 * staleness, so the coach works the list top-down.
 *
 *  - GET → one row per assigned client (coachId = me; super_admin/main_admin
 *    see every actively-assigned client) with last synced workout, last
 *    check-in, their day-deltas, the latest check-in body, and the pending
 *    suggestion count. Sorted stalest-first: max(daysSinceWorkout,
 *    daysSinceCheckIn) descending, and clients with NO data at all first —
 *    silence is the loudest signal. Plain sorted list, no scoring model.
 *
 * Guarded by requirePermission('coach.user.read'). Ownership is intrinsic:
 * the roster query only returns clients assigned to the caller.
 */

const DAY_MS = 86_400_000;

export function OPTIONS() {
  return preflight();
}

/** Driver timestamps arrive as strings; normalize to ISO, null when absent/bad. */
function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function daysSince(iso: string | null, now: number): number | null {
  if (iso === null) return null;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS));
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const seesAll = principal.role === 'super_admin' || principal.role === 'main_admin';

  // Correlated subqueries keep the roster one round-trip (coach/users idiom).
  const lastWorkoutAt = sql<string | null>`(
    select max(${syncedWorkouts.finishedAt})
    from ${syncedWorkouts}
    where ${syncedWorkouts.accountId} = ${accounts.id}
  )`;
  const lastCheckInAt = sql<string | null>`(
    select max(${checkIns.createdAt})
    from ${checkIns}
    where ${checkIns.accountId} = ${accounts.id}
  )`;
  const pendingSuggestions = sql<number>`(
    select count(*)::int
    from ${progressionSuggestions}
    where ${progressionSuggestions.accountId} = ${accounts.id}
      and ${progressionSuggestions.status} = 'pending'
  )`;

  const rosterConditions = [eq(coachAssignments.status, 'active')];
  if (!seesAll) rosterConditions.push(eq(coachAssignments.coachId, principal.id));

  const roster = await db
    .select({
      id: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
      lastWorkoutAt,
      lastCheckInAt,
      pendingSuggestions,
    })
    .from(coachAssignments)
    .innerJoin(accounts, eq(coachAssignments.userId, accounts.id))
    .where(and(...rosterConditions));

  // super/main_admin can see a user assigned to several coaches — dedupe.
  const clientsById = new Map(roster.map((r) => [r.id, r]));
  const clientIds = [...clientsById.keys()];
  if (clientIds.length === 0) return json({ clients: [] }, 200);

  // Latest check-in body per client, one extra round-trip for the whole list.
  const latestCheckIns = await db
    .selectDistinctOn([checkIns.accountId])
    .from(checkIns)
    .where(inArray(checkIns.accountId, clientIds))
    .orderBy(checkIns.accountId, desc(checkIns.createdAt));
  const latestByAccount = new Map(latestCheckIns.map((c) => [c.accountId, c]));

  const now = Date.now();
  const clients = [...clientsById.values()]
    .map((r) => {
      const workoutIso = toIso(r.lastWorkoutAt);
      const checkInIso = toIso(r.lastCheckInAt);
      return {
        id: r.id,
        displayName: r.displayName,
        email: r.email,
        lastWorkoutAt: workoutIso,
        lastCheckInAt: checkInIso,
        daysSinceWorkout: daysSince(workoutIso, now),
        daysSinceCheckIn: daysSince(checkInIso, now),
        latestCheckIn: latestByAccount.get(r.id) ?? null,
        pendingSuggestions: r.pendingSuggestions,
      };
    })
    .sort((a, b) => {
      // Stalest first; null (never) counts as infinitely stale. Explicit
      // compare because Infinity - Infinity is NaN.
      const staleness = (c: typeof a) =>
        Math.max(c.daysSinceWorkout ?? Infinity, c.daysSinceCheckIn ?? Infinity);
      const sa = staleness(a);
      const sb = staleness(b);
      if (sa === sb) return 0;
      return sb > sa ? 1 : -1;
    });

  return json({ clients }, 200);
}
