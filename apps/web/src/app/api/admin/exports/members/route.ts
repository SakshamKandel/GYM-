import { accounts, admins } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { asc, eq, gt } from 'drizzle-orm';
import { csvStreamResponse, dateStampedFilename } from '@/lib/csv';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — member directory CSV export (plan §3 P1-10).
 *
 *  GET /api/admin/exports/members → the full member roster, streamed as CSV.
 *  Same keyset as GET /api/admin/members (asc(accounts.email), email is
 *  unique so it's a stable single-column cursor) but walked internally in
 *  PAGE_SIZE batches so the response streams instead of buffering every row.
 *  `effectiveTier` (not just the raw stored `tier`) is included so a lapsed
 *  paid member reads as 'starter' in the export, matching what the console
 *  and every entitlement check already show.
 *
 * Guarded by requirePermission('members.read') — same read gate as the
 * directory itself; no additional export-specific permission.
 */

const PAGE_SIZE = 1000;
const HEADER = [
  'id',
  'email',
  'displayName',
  'tier',
  'effectiveTier',
  'tierExpiresAt',
  'tierSource',
  'status',
  'country',
  'staffRole',
  'createdAt',
] as const;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'members.read');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const now = new Date();

  const stream = csvStreamResponse<string>(
    dateStampedFilename('members'),
    HEADER,
    async (cursor) => {
      const rows = await db
        .select({
          id: accounts.id,
          email: accounts.email,
          displayName: accounts.displayName,
          tier: accounts.tier,
          tierExpiresAt: accounts.tierExpiresAt,
          tierSource: accounts.tierSource,
          status: accounts.status,
          country: accounts.country,
          createdAt: accounts.createdAt,
          staffRole: admins.role,
        })
        .from(accounts)
        .leftJoin(admins, eq(admins.accountId, accounts.id))
        .where(cursor ? gt(accounts.email, cursor) : undefined)
        .orderBy(asc(accounts.email))
        .limit(PAGE_SIZE);

      const csvRows = rows.map((r) => [
        r.id,
        r.email,
        r.displayName,
        r.tier,
        effectiveTier(r.tier, r.tierExpiresAt, now),
        r.tierExpiresAt ? r.tierExpiresAt.toISOString() : '',
        r.tierSource ?? '',
        r.status,
        r.country ?? '',
        r.staffRole ?? '',
        r.createdAt.toISOString(),
      ]);

      const last = rows[rows.length - 1];
      const nextCursor = rows.length === PAGE_SIZE && last ? last.email : null;
      return { rows: csvRows, nextCursor };
    },
  );

  return stream;
}
