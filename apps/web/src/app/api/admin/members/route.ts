import { accounts, admins } from '@gym/db';
import { and, asc, eq, ilike, type SQL } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — the member directory.
 *
 *  - GET → accounts (id, email, displayName, tier, status, staffRole). The
 *          left-joined `staffRole` (admins.role or null) lets the console
 *          render rank-aware controls — e.g. disable Suspend on rows the
 *          viewer does not outrank. Optional filters: `?q=` email substring
 *          (case-insensitive), `?status=active|suspended`. Capped at 100 rows
 *          so a large member base can't return an unbounded payload; the UI is
 *          expected to narrow with `q`.
 *
 * Guarded by requirePermission('members.read'); super_admin passes too.
 */

const MAX_ROWS = 100;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'members.read');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const params = new URL(req.url).searchParams;
  const q = params.get('q')?.trim();
  const status = params.get('status')?.trim();

  const clauses: SQL[] = [];
  if (q) clauses.push(ilike(accounts.email, `%${q}%`));
  if (status === 'active' || status === 'suspended') {
    clauses.push(eq(accounts.status, status));
  }

  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      status: accounts.status,
      staffRole: admins.role,
    })
    .from(accounts)
    .leftJoin(admins, eq(admins.accountId, accounts.id))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(asc(accounts.email))
    .limit(MAX_ROWS);

  return json({ members: rows }, 200);
}
