import { accounts, mealOrders, mealPartners } from '@gym/db';
import { ORDER_STATUSES, TERMINAL_ORDER_STATUSES, type OrderStatus } from '@gym/shared';
import { and, desc, eq, inArray, lt, notInArray, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { csvStreamResponse, dateStampedFilename } from '@/lib/csv';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — order-oversight CSV export (N8, console-scale wave). Mirrors
 * the ACTIVE filters of the order-oversight board (`GET /api/admin/orders` /
 * `OrdersOversight.tsx`): `date` (exact deliveryDate), `partnerId` (exact),
 * `status` (exact), `scope` (active | history | all, default 'active' — same
 * default as the board). Streams every matching row, newest-placed first, via
 * the same (placedAt, id) keyset cursor idiom as the other exports/* routes —
 * bounded per-page queries so a multi-thousand-row export never buffers the
 * whole result set. Line items are intentionally NOT flattened in (an order
 * can have many); the CSV is one row per order for a finance/ops rollup, not a
 * line-item ledger.
 *
 * Guarded by requirePermission('orders.review') — same gate as the board and
 * its underlying API route. Does not touch order-detail logic or mutate
 * anything (this is a GET-only projection).
 */

const PAGE_SIZE = 1000;
const HEADER = [
  'id',
  'partnerId',
  'partnerName',
  'accountId',
  'accountEmail',
  'source',
  'deliveryDate',
  'window',
  'status',
  'paymentMethod',
  'paymentStatus',
  'subtotalMinor',
  'deliveryFeeMinor',
  'smallOrderFeeMinor',
  'totalMinor',
  'currency',
  'placedAt',
  'deliveredAt',
  'cancelledAt',
  'cancelReason',
] as const;

type Cursor = { placedAt: string; id: string };

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  partnerId: z.string().trim().min(1).optional(),
  status: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]).optional(),
  scope: z.enum(['active', 'history', 'all']).default('active'),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'orders.review');
  if (principal instanceof Response) return principal;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get('date') ?? undefined,
    partnerId: url.searchParams.get('partnerId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    scope: url.searchParams.get('scope') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const filters = parsed.data;

  const staticClauses: SQL[] = [];
  if (filters.date) staticClauses.push(eq(mealOrders.deliveryDate, filters.date));
  if (filters.partnerId) staticClauses.push(eq(mealOrders.partnerId, filters.partnerId));
  if (filters.status) staticClauses.push(eq(mealOrders.status, filters.status));
  const terminal = [...TERMINAL_ORDER_STATUSES];
  if (filters.scope === 'active') staticClauses.push(notInArray(mealOrders.status, terminal));
  if (filters.scope === 'history') staticClauses.push(inArray(mealOrders.status, terminal));

  const db = getDb();
  const filenameBase = filters.status
    ? `meal-orders-${filters.status}`
    : filters.scope !== 'active'
      ? `meal-orders-${filters.scope}`
      : 'meal-orders';

  const stream = csvStreamResponse<Cursor>(
    dateStampedFilename(filenameBase),
    HEADER,
    async (cursor) => {
      const cursorClause = cursor
        ? or(
            lt(mealOrders.placedAt, new Date(cursor.placedAt)),
            and(eq(mealOrders.placedAt, new Date(cursor.placedAt)), lt(mealOrders.id, cursor.id)),
          )
        : undefined;
      const clauses = cursorClause ? [...staticClauses, cursorClause] : staticClauses;

      const rows = await db
        .select({
          id: mealOrders.id,
          partnerId: mealOrders.partnerId,
          partnerName: mealPartners.name,
          accountId: mealOrders.accountId,
          accountEmail: accounts.email,
          source: mealOrders.source,
          deliveryDate: mealOrders.deliveryDate,
          window: mealOrders.window,
          status: mealOrders.status,
          paymentMethod: mealOrders.paymentMethod,
          paymentStatus: mealOrders.paymentStatus,
          subtotalMinor: mealOrders.subtotalMinor,
          deliveryFeeMinor: mealOrders.deliveryFeeMinor,
          smallOrderFeeMinor: mealOrders.smallOrderFeeMinor,
          totalMinor: mealOrders.totalMinor,
          currency: mealOrders.currency,
          placedAt: mealOrders.placedAt,
          deliveredAt: mealOrders.deliveredAt,
          cancelledAt: mealOrders.cancelledAt,
          cancelReason: mealOrders.cancelReason,
        })
        .from(mealOrders)
        .innerJoin(mealPartners, eq(mealPartners.id, mealOrders.partnerId))
        .innerJoin(accounts, eq(accounts.id, mealOrders.accountId))
        .where(clauses.length ? and(...clauses) : undefined)
        .orderBy(desc(mealOrders.placedAt), desc(mealOrders.id))
        .limit(PAGE_SIZE);

      const csvRows = rows.map((r) => [
        r.id,
        r.partnerId,
        r.partnerName,
        r.accountId,
        r.accountEmail,
        r.source,
        r.deliveryDate,
        r.window,
        r.status,
        r.paymentMethod,
        r.paymentStatus,
        r.subtotalMinor,
        r.deliveryFeeMinor,
        r.smallOrderFeeMinor,
        r.totalMinor,
        r.currency,
        r.placedAt.toISOString(),
        r.deliveredAt ? r.deliveredAt.toISOString() : '',
        r.cancelledAt ? r.cancelledAt.toISOString() : '',
        r.cancelReason ?? '',
      ]);

      const last = rows[rows.length - 1];
      const nextCursor =
        rows.length === PAGE_SIZE && last
          ? { placedAt: last.placedAt.toISOString(), id: last.id }
          : null;
      return { rows: csvRows, nextCursor };
    },
  );

  return stream;
}
