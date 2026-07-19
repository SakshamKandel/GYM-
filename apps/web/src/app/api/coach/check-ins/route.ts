import { accounts, checkIns, coachAssignments } from '@gym/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — client check-ins. Two modes off one route:
 *
 *  - GET            → DISTINCT ON (account) newest check-in for every client
 *                     with an ACTIVE coach_assignments row where coachId = me
 *                     (super_admin/main_admin see all). Each row carries
 *                     `replied` and the member identity. Newest first. Powers
 *                     the roster overview.
 *  - GET ?userId=X  → ONE client's check-in HISTORY (newest first, bounded),
 *                     so a coach sees the trend, not just the latest snapshot
 *                     (Pack K). Guarded by requireCoachOwnsUser(X) → 403 when
 *                     the caller has no active assignment over that client.
 *
 * Guarded by requirePermission('coach.user.read'); the reply write guard
 * (requireCoachOwnsUser) lives on the reply route.
 */

/** Newest N rows for the single-client history — a long history stays bounded. */
const HISTORY_LIMIT = 60;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const userId = new URL(req.url).searchParams.get('userId');

  // --- Single-client history mode -------------------------------------------
  if (userId) {
    if (!(await requireCoachOwnsUser(principal, userId))) {
      return json({ error: 'forbidden' }, 403);
    }
    const rows = await db
      .select({
        id: checkIns.id,
        date: checkIns.date,
        bodyweightKg: checkIns.bodyweightKg,
        sleep: checkIns.sleep,
        energy: checkIns.energy,
        soreness: checkIns.soreness,
        note: checkIns.note,
        summary: checkIns.summary,
        coachReplyMessageId: checkIns.coachReplyMessageId,
        createdAt: checkIns.createdAt,
      })
      .from(checkIns)
      .where(eq(checkIns.accountId, userId))
      .orderBy(desc(checkIns.date), desc(checkIns.createdAt))
      .limit(HISTORY_LIMIT);

    const history = rows.map((r) => ({ ...r, replied: r.coachReplyMessageId !== null }));
    // A chronological (oldest→newest) bodyweight series for a trend sparkline.
    const weightSeries = [...rows]
      .filter((r) => r.bodyweightKg !== null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: r.date, kg: r.bodyweightKg as number }));

    return json({ checkIns: history, weightSeries }, 200);
  }

  // --- Roster overview mode (latest per client) -----------------------------
  const seesAll = principal.role === 'super_admin' || principal.role === 'main_admin';

  const conditions = [];
  if (!seesAll) {
    conditions.push(
      sql`exists (
        select 1 from ${coachAssignments}
        where ${coachAssignments.userId} = ${checkIns.accountId}
          and ${coachAssignments.coachId} = ${principal.id}
          and ${coachAssignments.status} = 'active'
      )`,
    );
  }

  const rows = await db
    .selectDistinctOn([checkIns.accountId], {
      id: checkIns.id,
      accountId: checkIns.accountId,
      date: checkIns.date,
      bodyweightKg: checkIns.bodyweightKg,
      sleep: checkIns.sleep,
      energy: checkIns.energy,
      soreness: checkIns.soreness,
      note: checkIns.note,
      summary: checkIns.summary,
      coachReplyMessageId: checkIns.coachReplyMessageId,
      createdAt: checkIns.createdAt,
      user: {
        id: accounts.id,
        displayName: accounts.displayName,
        email: accounts.email,
      },
    })
    .from(checkIns)
    .innerJoin(accounts, eq(checkIns.accountId, accounts.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(checkIns.accountId, desc(checkIns.createdAt));

  // DISTINCT ON forces accountId ordering in SQL; re-sort newest-first here.
  const sorted = rows
    .map((r) => ({ ...r, replied: r.coachReplyMessageId !== null }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return json({ checkIns: sorted }, 200);
}
