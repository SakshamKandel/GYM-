import { syncedWorkouts } from '@gym/db';
import { and, desc, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * The caller's own unranked (flagged) workouts. Feeds the mobile "Not counted
 * toward rankings — fix this entry?" quiet prompt in history (design law 4 —
 * no accusation, no punishment, just a factual note).
 *
 *  - GET (no query) → newest first, limit 20 — for the history LIST view.
 *  - GET ?workoutId=<id> → that single workout's flag status regardless of
 *    how old it is, so the per-workout detail screen's check is never a
 *    false negative just because the account has more than 20 flags on
 *    record (the list-view truncation doesn't apply to a targeted lookup).
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const workoutId = new URL(req.url).searchParams.get('workoutId');

  const query = getDb()
    .select({
      workoutId: syncedWorkouts.id,
      date: syncedWorkouts.date,
      name: syncedWorkouts.name,
      reason: syncedWorkouts.flagReason,
    })
    .from(syncedWorkouts)
    .where(
      workoutId
        ? and(
            eq(syncedWorkouts.accountId, user.id),
            eq(syncedWorkouts.ranked, false),
            eq(syncedWorkouts.id, workoutId),
          )
        : and(eq(syncedWorkouts.accountId, user.id), eq(syncedWorkouts.ranked, false)),
    )
    .orderBy(desc(syncedWorkouts.date));

  const rows = workoutId ? await query.limit(1) : await query.limit(20);

  return json({ flags: rows }, 200);
}
