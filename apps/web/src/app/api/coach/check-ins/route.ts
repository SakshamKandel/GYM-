import { accounts, checkIns, coachAssignments } from '@gym/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the LATEST check-in per assigned client.
 *
 *  - GET → DISTINCT ON (account) newest check-in for every client with an
 *    ACTIVE coach_assignments row where coachId = me (super_admin/main_admin
 *    see all clients). Each row carries `replied` (a coach reply already
 *    exists) and the member's identity. Sorted newest check-in first.
 *
 * Guarded by requirePermission('coach.user.read'); the reply write guard
 * (requireCoachOwnsUser) lives on the reply route.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const db = getDb();
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
