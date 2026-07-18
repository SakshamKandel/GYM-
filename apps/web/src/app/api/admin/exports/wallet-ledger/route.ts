import { accounts, walletLedger } from '@gym/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { csvStreamResponse, dateStampedFilename } from '@/lib/csv';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — wallet-ledger CSV export (plan §3 P1-10).
 *
 *  GET /api/admin/exports/wallet-ledger → the FULL append-only wallet_ledger
 *  (commissions, adjustments, payouts, across every coach — current AND
 *  offboarded, since money history is never deleted), newest first, streamed
 *  as CSV. Same (createdAt, id) keyset tuple idiom as the audit export,
 *  walked internally in PAGE_SIZE batches.
 *
 * Guarded by requirePermission('wallet.manage') — super_admin + main_admin
 * only, same gate as the wallets console.
 */

const PAGE_SIZE = 1000;
const HEADER = [
  'id',
  'coachId',
  'coachEmail',
  'type',
  'amountMinor',
  'currency',
  'sourceType',
  'sourceId',
  'note',
  'createdBy',
  'createdAt',
] as const;

type Cursor = { createdAt: string; id: string };

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'wallet.manage');
  if (principal instanceof Response) return principal;

  const db = getDb();

  const stream = csvStreamResponse<Cursor>(
    dateStampedFilename('wallet-ledger'),
    HEADER,
    async (cursor) => {
      const cursorClause = cursor
        ? or(
            lt(walletLedger.createdAt, new Date(cursor.createdAt)),
            and(
              eq(walletLedger.createdAt, new Date(cursor.createdAt)),
              lt(walletLedger.id, cursor.id),
            ),
          )
        : undefined;

      const rows = await db
        .select({
          id: walletLedger.id,
          coachId: walletLedger.coachId,
          coachEmail: accounts.email,
          type: walletLedger.type,
          amountMinor: walletLedger.amountMinor,
          currency: walletLedger.currency,
          sourceType: walletLedger.sourceType,
          sourceId: walletLedger.sourceId,
          note: walletLedger.note,
          createdBy: walletLedger.createdBy,
          createdAt: walletLedger.createdAt,
        })
        .from(walletLedger)
        .innerJoin(accounts, eq(accounts.id, walletLedger.coachId))
        .where(cursorClause)
        .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
        .limit(PAGE_SIZE);

      const csvRows = rows.map((r) => [
        r.id,
        r.coachId,
        r.coachEmail,
        r.type,
        r.amountMinor,
        r.currency,
        r.sourceType ?? '',
        r.sourceId ?? '',
        r.note ?? '',
        r.createdBy ?? '',
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
