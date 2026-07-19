import { accounts, mealBillingCycles, mealOrders, mealPaymentRequests } from '@gym/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { csvStreamResponse, dateStampedFilename } from '@/lib/csv';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — meal-payment-requests CSV export (WP-11 / P0-10 sibling of
 * the subscription payments export). Streams every meal manual-payment
 * request (any status, order- or cycle-scoped), newest first, via the same
 * (createdAt, id) keyset cursor idiom as exports/payment-requests. Receipt
 * images are intentionally excluded (opaque Cloudinary uid needing a signed
 * per-request mint — reviewers open the receipt from the console instead).
 *
 * Guarded by requirePermission('payments.review') — same gate as the queue
 * and the underlying GET/POST /api/admin/meal-payments/** routes.
 */

const PAGE_SIZE = 1000;
const HEADER = [
  'id',
  'accountId',
  'accountEmail',
  'targetKind',
  'targetId',
  'amountMinor',
  'currency',
  'method',
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
    dateStampedFilename('meal-payment-requests'),
    HEADER,
    async (cursor) => {
      const cursorClause = cursor
        ? or(
            lt(mealPaymentRequests.createdAt, new Date(cursor.createdAt)),
            and(
              eq(mealPaymentRequests.createdAt, new Date(cursor.createdAt)),
              lt(mealPaymentRequests.id, cursor.id),
            ),
          )
        : undefined;

      const rows = await db
        .select({
          id: mealPaymentRequests.id,
          accountId: mealPaymentRequests.accountId,
          accountEmail: accounts.email,
          orderId: mealPaymentRequests.orderId,
          cycleId: mealPaymentRequests.cycleId,
          amountMinor: mealPaymentRequests.amountMinor,
          currency: mealPaymentRequests.currency,
          method: mealPaymentRequests.method,
          status: mealPaymentRequests.status,
          reviewNote: mealPaymentRequests.reviewNote,
          decidedAt: mealPaymentRequests.decidedAt,
          createdAt: mealPaymentRequests.createdAt,
        })
        .from(mealPaymentRequests)
        .innerJoin(accounts, eq(accounts.id, mealPaymentRequests.accountId))
        .leftJoin(mealOrders, eq(mealOrders.id, mealPaymentRequests.orderId))
        .leftJoin(mealBillingCycles, eq(mealBillingCycles.id, mealPaymentRequests.cycleId))
        .where(cursorClause)
        .orderBy(desc(mealPaymentRequests.createdAt), desc(mealPaymentRequests.id))
        .limit(PAGE_SIZE);

      const csvRows = rows.map((r) => [
        r.id,
        r.accountId,
        r.accountEmail,
        r.orderId ? 'order' : 'cycle',
        r.orderId ?? r.cycleId ?? '',
        r.amountMinor,
        r.currency,
        r.method,
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
