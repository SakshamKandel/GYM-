import { accounts, admins } from '@gym/db';
import { and, asc, eq, gt, ilike, type SQL } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — the member directory.
 *
 *  GET /api/admin/members?q=&status=&tier=&cursor=
 *    - `q`      → case-insensitive substring match on email.
 *    - `status` → exact filter, 'active' | 'suspended'.
 *    - `tier`   → exact filter, 'starter' | 'silver' | 'gold' | 'elite'
 *                 (added alongside pagination so the web console's tier
 *                 filter is correct across pages, not just within one).
 *    - `cursor` → keyset page token: the previous page's LAST row email.
 *                 Returns rows with email STRICTLY GREATER than the cursor,
 *                 continuing the same asc(accounts.email) order. email is
 *                 unique (accounts.email has a unique constraint) so it is a
 *                 stable single-column keyset — no id tie-breaker needed.
 *
 *  Response: { members: [...], nextCursor: string | null } — `nextCursor` is
 *  an ADDITIVE field. The mobile staff console (getMembers() in
 *  apps/mobile/src/features/staff/api.ts) still calls `?q=` only and parses
 *  the response with a non-strict zod object that reads just `members`, so
 *  it keeps working unchanged; `tier`/`cursor` are optional and ignored by
 *  mobile unless it later adopts them. Page size is PAGE_SIZE (was previously
 *  a flat 100-row cap with no way to reach further rows).
 *
 * Guarded by requirePermission('members.read'); super_admin passes too.
 */

const PAGE_SIZE = 50;
const TIERS = ['starter', 'silver', 'gold', 'elite'] as const;

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
  const tier = params.get('tier')?.trim();
  const cursor = params.get('cursor')?.trim();

  const clauses: SQL[] = [];
  if (q) clauses.push(ilike(accounts.email, `%${q}%`));
  if (status === 'active' || status === 'suspended') {
    clauses.push(eq(accounts.status, status));
  }
  if (tier && (TIERS as readonly string[]).includes(tier)) {
    clauses.push(eq(accounts.tier, tier as (typeof TIERS)[number]));
  }
  // Keyset: rows strictly after the cursor tuple in the (email asc) order.
  if (cursor) clauses.push(gt(accounts.email, cursor));

  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      status: accounts.status,
      createdAt: accounts.createdAt,
      staffRole: admins.role,
    })
    .from(accounts)
    .leftJoin(admins, eq(admins.accountId, accounts.id))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(asc(accounts.email))
    // Fetch one extra row to know whether a further page exists.
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? last.email : null;

  const members = page.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    tier: r.tier,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    staffRole: r.staffRole ?? null,
  }));

  return json({ members, nextCursor }, 200);
}
