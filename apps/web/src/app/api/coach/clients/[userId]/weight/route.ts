import { checkIns } from '@gym/db';
import { type DatedWeight, smoothWeights, trendSummary } from '@gym/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — a client's bodyweight series + smoothed trend (Pack K weight/
 * EWMA read layer). The server's authoritative bodyweight signal is the
 * `bodyweightKg` a member logs on each weekly check-in (the local weight_logs
 * table is device-side and not synced to Neon yet — §6). We run the SAME EWMA
 * smoothing the mobile Body tab uses (@gym/shared smoothWeights/trendSummary)
 * so the coach reads the trend line, not the daily scale noise.
 *
 * Guards (fail closed): requirePermission('coach.user.read') +
 * requireCoachOwnsUser(userId).
 */

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
    .select({ date: checkIns.date, bodyweightKg: checkIns.bodyweightKg })
    .from(checkIns)
    .where(and(eq(checkIns.accountId, userId), sql`${checkIns.bodyweightKg} is not null`))
    .orderBy(asc(checkIns.date));

  const entries: DatedWeight[] = rows.map((r) => ({
    date: r.date,
    kg: r.bodyweightKg as number,
  }));

  const points = smoothWeights(entries);
  const summary = trendSummary(points);

  return json({ points, summary, count: points.length }, 200);
}
