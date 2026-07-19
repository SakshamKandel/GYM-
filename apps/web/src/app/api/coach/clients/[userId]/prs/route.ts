import { syncedSets } from '@gym/db';
import { epley1Rm } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — a client's personal records (Pack K PRs read layer). PRs are
 * the `is_pr=true` synced_sets (server-flagged during sync via the same
 * @gym/shared pr.ts logic the mobile PR engine uses). We collapse them to the
 * BEST estimated-1RM set per exercise (Epley, the same estimator the app uses)
 * plus a bounded recent-PR feed, so the coach sees both current bests and
 * momentum without loading the whole set history.
 *
 * Guards (fail closed): requirePermission('coach.user.read') +
 * requireCoachOwnsUser(userId). Exercise names are catalog strings, not member
 * free text.
 */

/** Cap the recent-PR feed so a very active lifter can't return unbounded rows. */
const RECENT_LIMIT = 30;

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

  const rows = await getDb()
    .select({
      exerciseId: syncedSets.exerciseId,
      exerciseName: syncedSets.exerciseName,
      weightKg: syncedSets.weightKg,
      reps: syncedSets.reps,
      loggedAt: syncedSets.loggedAt,
    })
    .from(syncedSets)
    .where(and(eq(syncedSets.accountId, userId), eq(syncedSets.isPr, true)))
    .orderBy(desc(syncedSets.loggedAt));

  // Best e1RM set per exercise (the current record), computed with the app's
  // own Epley estimator so the coach's number matches the member's.
  const bestByExercise = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      weightKg: number;
      reps: number;
      e1rm: number;
      loggedAt: Date;
    }
  >();
  for (const r of rows) {
    const e1rm = Math.round(epley1Rm(r.weightKg, r.reps) * 10) / 10;
    const prev = bestByExercise.get(r.exerciseId);
    if (!prev || e1rm > prev.e1rm) {
      bestByExercise.set(r.exerciseId, {
        exerciseId: r.exerciseId,
        exerciseName: r.exerciseName,
        weightKg: r.weightKg,
        reps: r.reps,
        e1rm,
        loggedAt: r.loggedAt,
      });
    }
  }

  const records = [...bestByExercise.values()].sort((a, b) => b.e1rm - a.e1rm);
  const recent = rows.slice(0, RECENT_LIMIT).map((r) => ({
    exerciseName: r.exerciseName,
    weightKg: r.weightKg,
    reps: r.reps,
    e1rm: Math.round(epley1Rm(r.weightKg, r.reps) * 10) / 10,
    loggedAt: r.loggedAt,
  }));

  return json({ records, recent, totalPrs: rows.length }, 200);
}
