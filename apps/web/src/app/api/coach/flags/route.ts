import { accounts, coachAssignments, syncedSets, syncedWorkouts, workoutFlagAcks } from '@gym/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — unranked (flagged) workouts of assigned clients, unacked
 * first so the coach clears the newest surprises before the acknowledged
 * backlog. Each row carries its heaviest set (by weight) as `topSet` context
 * — enough for a coach to eyeball plausibility without opening the workout.
 *
 * Guarded by requirePermission('coach.user.read'); acknowledging is a
 * separate mutation-permission'd route.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const seesAll = principal.role === 'super_admin' || principal.role === 'main_admin';

  const conditions = [eq(syncedWorkouts.ranked, false)];
  if (!seesAll) {
    conditions.push(
      sql`exists (
        select 1 from ${coachAssignments}
        where ${coachAssignments.userId} = ${syncedWorkouts.accountId}
          and ${coachAssignments.coachId} = ${principal.id}
          and ${coachAssignments.status} = 'active'
      )`,
    );
  }

  const rows = await db
    .select({
      workoutId: syncedWorkouts.id,
      userId: syncedWorkouts.accountId,
      date: syncedWorkouts.date,
      name: syncedWorkouts.name,
      reason: syncedWorkouts.flagReason,
      displayName: accounts.displayName,
      acked: sql<boolean>`(${workoutFlagAcks.workoutId} is not null)`,
    })
    .from(syncedWorkouts)
    .innerJoin(accounts, eq(syncedWorkouts.accountId, accounts.id))
    .leftJoin(workoutFlagAcks, eq(workoutFlagAcks.workoutId, syncedWorkouts.id))
    .where(and(...conditions))
    .orderBy(sql`(${workoutFlagAcks.workoutId} is not null) asc`, desc(syncedWorkouts.date))
    .limit(200);

  const workoutIds = rows.map((r) => r.workoutId);
  const setRows =
    workoutIds.length > 0
      ? await db
          .select({
            workoutId: syncedSets.workoutId,
            exerciseName: syncedSets.exerciseName,
            weightKg: syncedSets.weightKg,
            reps: syncedSets.reps,
          })
          .from(syncedSets)
          .where(inArray(syncedSets.workoutId, workoutIds))
      : [];

  const topSetByWorkout = new Map<string, { exerciseName: string; weightKg: number; reps: number }>();
  for (const s of setRows) {
    const prev = topSetByWorkout.get(s.workoutId);
    if (!prev || s.weightKg > prev.weightKg) {
      topSetByWorkout.set(s.workoutId, { exerciseName: s.exerciseName, weightKg: s.weightKg, reps: s.reps });
    }
  }

  const items = rows
    .map((r) => ({
      workoutId: r.workoutId,
      userId: r.userId,
      displayName: r.displayName,
      date: r.date,
      name: r.name,
      reason: r.reason,
      topSet: topSetByWorkout.get(r.workoutId) ?? null,
      acked: r.acked,
    }))
    .sort((a, b) => Number(a.acked) - Number(b.acked));

  return json({ items }, 200);
}
