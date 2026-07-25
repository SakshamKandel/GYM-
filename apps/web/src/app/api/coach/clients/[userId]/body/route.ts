import { memberMeasurements, memberWeightLogs } from '@gym/db';
import {
  coachClientBodyResponseSchema,
  coachClientReadWindow,
  COACH_CLIENT_READ_MAX_DAY_ROWS,
  smoothWeights,
  trendSummary,
  type DatedWeight,
} from '@gym/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — a client's BODY data (bodyweight trend + measurements),
 * read-only. Sibling of `.../nutrition`: same guards, same `?days=` window.
 *
 * Source of truth: the member's own logs, replicated device→Neon by
 * `POST /api/sync/member-data` into `member_weight_logs` +
 * `member_measurements`. Deletes are tombstones, so `deleted=false` is
 * required — a weigh-in the member removed must not reappear in the coach's
 * chart. Distinct from `.../weight`, which reads the weekly CHECK-IN bodyweight
 * (coach-verified, sparser); this is the member's day-to-day scale history.
 *
 * The series runs through the SAME EWMA smoothing the member's Body tab uses
 * (@gym/shared smoothWeights/trendSummary) so the coach reads the trend line,
 * not the daily scale noise.
 *
 * No member free text is returned here (measurements are numbers), so there is
 * nothing to maskPii.
 *
 * Guards (fail closed): requirePermission('coach.user.read') +
 * requireCoachOwnsUser(userId) → 403 without an ACTIVE assignment (super_admin/
 * main_admin pass without one). The partner role holds neither permission.
 */

/** Measurements are not one-per-day, so they carry their own row ceiling. */
const MEASUREMENT_ROW_LIMIT = 400;

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

  const { rangeDays, since, until } = coachClientReadWindow(
    new URL(req.url).searchParams.get('days'),
  );

  const db = getDb();

  const [weightRows, measurementRows] = await Promise.all([
    db
      .select({ date: memberWeightLogs.date, kg: memberWeightLogs.kg })
      .from(memberWeightLogs)
      .where(
        and(
          eq(memberWeightLogs.accountId, userId),
          eq(memberWeightLogs.deleted, false),
          gte(memberWeightLogs.date, since),
          lte(memberWeightLogs.date, until),
        ),
      )
      .orderBy(asc(memberWeightLogs.date))
      // One row per date by primary key, so the window itself is the ceiling.
      .limit(COACH_CLIENT_READ_MAX_DAY_ROWS),
    db
      .select({
        id: memberMeasurements.id,
        date: memberMeasurements.date,
        waistCm: memberMeasurements.waistCm,
        chestCm: memberMeasurements.chestCm,
        armCm: memberMeasurements.armCm,
        hipCm: memberMeasurements.hipCm,
        thighCm: memberMeasurements.thighCm,
      })
      .from(memberMeasurements)
      .where(
        and(
          eq(memberMeasurements.accountId, userId),
          eq(memberMeasurements.deleted, false),
          gte(memberMeasurements.date, since),
          lte(memberMeasurements.date, until),
        ),
      )
      .orderBy(desc(memberMeasurements.date))
      .limit(MEASUREMENT_ROW_LIMIT),
  ]);

  const entries: DatedWeight[] = weightRows.map((row) => ({ date: row.date, kg: row.kg }));
  const points = smoothWeights(entries);

  const body = coachClientBodyResponseSchema.parse({
    synced: weightRows.length > 0 || measurementRows.length > 0,
    points,
    summary: trendSummary(points),
    measurements: measurementRows,
    rangeDays,
    since,
  });

  return json(body, 200);
}
