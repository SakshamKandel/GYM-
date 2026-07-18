import { accounts, paymentRequests } from '@gym/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { csvStreamResponse, dateStampedFilename } from '@/lib/csv';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — payment-requests CSV export (plan §3 P1-10).
 *
 *  GET /api/admin/exports/payment-requests → every manual payment request
 *  (any status), newest first, streamed as CSV. Same (createdAt, id) keyset
 *  tuple idiom as GET /api/admin/audit, walked internally in PAGE_SIZE
 *  batches. Receipt images are intentionally NOT included (the stored value
 *  is an opaque Cloudinary uid requiring a signed per-request URL mint — out
 *  of scope for a flat export; reviewers open the receipt from the console).
 *
 * Guarded by requirePermission('payments.review') — same gate as the queue.
 */

const PAGE_SIZE = 1000;
const HEADER = [
  'id',
  'accountId',
  'accountEmail',
  'tier',
  'months',
  'region',
  'amountMinor',
  'currency',
  'method',
  'discountPct',
  'status',
  'reviewNote',
  'decidedAt',
  'createdAt',
] as const;

type Cursor = { createdAt: string; id: string };

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'payments.review');
  if (principal instanceof Response) return principal;

  const db = getDb();

  const stream = csvStreamResponse<Cursor>(
    dateStampedFilename('payment-requests'),
    HEADER,
    async (cursor) => {
      const cursorClause = cursor
        ? or(
            lt(paymentRequests.createdAt, new Date(cursor.createdAt)),
            and(
              eq(paymentRequests.createdAt, new Date(cursor.createdAt)),
              lt(paymentRequests.id, cursor.id),
            ),
          )
        : undefined;

      const rows = await db
        .select({
          id: paymentRequests.id,
          accountId: paymentRequests.accountId,
          accountEmail: accounts.email,
          tier: paymentRequests.tier,
          months: paymentRequests.months,
          region: paymentRequests.region,
          amountMinor: paymentRequests.amountMinor,
          currency: paymentRequests.currency,
          method: paymentRequests.method,
          discountPct: paymentRequests.discountPct,
          status: paymentRequests.status,
          reviewNote: paymentRequests.reviewNote,
          decidedAt: paymentRequests.decidedAt,
          createdAt: paymentRequests.createdAt,
        })
        .from(paymentRequests)
        .innerJoin(accounts, eq(accounts.id, paymentRequests.accountId))
        .where(cursorClause)
        .orderBy(desc(paymentRequests.createdAt), desc(paymentRequests.id))
        .limit(PAGE_SIZE);

      const csvRows = rows.map((r) => [
        r.id,
        r.accountId,
        r.accountEmail,
        r.tier,
        r.months,
        r.region,
        r.amountMinor,
        r.currency,
        r.method,
        r.discountPct ?? '',
        r.status,
        r.reviewNote ?? '',
        r.decidedAt ? r.decidedAt.toISOString() : '',
        r.createdAt.toISOString(),
      ]);

      const last = rows[rows.length - 1];
      const nextCursor =
        rows.length === PAGE_SIZE && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null;
      return { rows: csvRows, nextCursor };
    },
  );

  return stream;
}
