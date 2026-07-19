import { accounts, gymReports, gyms } from '@gym/db';
import { asc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin queue: member-reported gym-listing corrections (Pack M / B15-adjacent
 * moderation surface). Open reports first (oldest first within the queue, so
 * the longest-waiting report surfaces), resolved/dismissed after. Gated on
 * `gyms.manage` — the same permission that unlocks the gym CRUD editor.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const rows = await getDb()
    .select({
      id: gymReports.id,
      gymId: gymReports.gymId,
      gymName: gyms.name,
      gymSlug: gyms.slug,
      field: gymReports.field,
      note: gymReports.note,
      status: gymReports.status,
      createdAt: gymReports.createdAt,
      reporterEmail: accounts.email,
    })
    .from(gymReports)
    .innerJoin(gyms, eq(gyms.id, gymReports.gymId))
    .innerJoin(accounts, eq(accounts.id, gymReports.accountId))
    .orderBy(asc(gymReports.status), asc(gymReports.createdAt));

  const reports = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  // Most-recent-first is friendlier once a report is already resolved/dismissed
  // — re-sort those two states desc while keeping 'open' oldest-first above.
  reports.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : b.status === 'open' ? 1 : 0;
    if (a.status === 'open') return 0; // already asc by createdAt from SQL
    return b.createdAt.localeCompare(a.createdAt);
  });

  return json({ reports }, 200);
}
