import { syncedSets, syncedWorkouts } from '@gym/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — a client's LOGGED training history (Pack K), read-only, over
 * the account-scoped synced_workouts / synced_sets. Distinct from
 * clients/[userId]/workouts, which serves coach-ASSIGNED programs; this is what
 * the member actually did. Paginated newest-first (a long history must never
 * load unbounded rows); each workout carries its sets so the coach sees
 * exercise/weight/reps/PR flags without a second round trip.
 *
 * Guards (fail closed): requirePermission('coach.user.read') +
 * requireCoachOwnsUser(userId). Exercise names are the app's own catalog
 * strings (not member free text) so no maskPii is needed.
 */

const PAGE_MAX = 20;

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const url = new URL(req.url);
  const limit = Math.min(
    PAGE_MAX,
    Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '10', 10) || 10),
  );
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

  const db = getDb();

  const workouts = await db
    .select({
      id: syncedWorkouts.id,
      date: syncedWorkouts.date,
      name: syncedWorkouts.name,
      startedAt: syncedWorkouts.startedAt,
      finishedAt: syncedWorkouts.finishedAt,
      durationSec: syncedWorkouts.durationSec,
      ranked: syncedWorkouts.ranked,
    })
    .from(syncedWorkouts)
    .where(eq(syncedWorkouts.accountId, userId))
    .orderBy(desc(syncedWorkouts.date), desc(syncedWorkouts.finishedAt))
    .limit(limit + 1) // one extra row => hasMore without a count query
    .offset(offset);

  const hasMore = workouts.length > limit;
  const page = hasMore ? workouts.slice(0, limit) : workouts;

  // One batched fetch for every set on this page, grouped in memory (avoids an
  // N+1 per-workout query).
  const workoutIds = page.map((w) => w.id);
  const sets =
    workoutIds.length === 0
      ? []
      : await db
          .select({
            workoutId: syncedSets.workoutId,
            exerciseName: syncedSets.exerciseName,
            setNo: syncedSets.setNo,
            weightKg: syncedSets.weightKg,
            reps: syncedSets.reps,
            rpe: syncedSets.rpe,
            isPr: syncedSets.isPr,
          })
          .from(syncedSets)
          .where(inArray(syncedSets.workoutId, workoutIds))
          .orderBy(asc(syncedSets.setNo));

  const setsByWorkout = new Map<string, typeof sets>();
  for (const s of sets) {
    const list = setsByWorkout.get(s.workoutId) ?? [];
    list.push(s);
    setsByWorkout.set(s.workoutId, list);
  }

  const items = page.map((w) => ({
    ...w,
    sets: (setsByWorkout.get(w.id) ?? []).map(({ workoutId: _w, ...s }) => s),
  }));

  return json({ workouts: items, hasMore, nextOffset: offset + page.length }, 200);
}
