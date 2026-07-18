import { accounts, auditLog } from '@gym/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { csvStreamResponse, dateStampedFilename } from '@/lib/csv';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — audit-log CSV export (plan §3 P1-10).
 *
 *  GET /api/admin/exports/audit → the full audit trail, newest first,
 *  streamed as CSV. Same (createdAt, id) keyset tuple + ordering as
 *  GET /api/admin/audit, walked internally in PAGE_SIZE batches so the
 *  response streams rather than buffering the whole log in memory. `meta` is
 *  JSON-stringified into a single field (it is an arbitrary object per
 *  action, so there is no fixed column set to flatten it into).
 *
 * Guarded by requirePermission('audit.read') — super_admin + main_admin only,
 * same gate as the audit page.
 */

const PAGE_SIZE = 1000;
const HEADER = [
  'id',
  'actorId',
  'actorEmail',
  'action',
  'targetType',
  'targetId',
  'meta',
  'ip',
  'createdAt',
] as const;

type Cursor = { createdAt: string; id: string };

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'audit.read');
  if (principal instanceof Response) return principal;

  const db = getDb();

  const stream = csvStreamResponse<Cursor>(
    dateStampedFilename('audit-log'),
    HEADER,
    async (cursor) => {
      const cursorClause = cursor
        ? or(
            lt(auditLog.createdAt, new Date(cursor.createdAt)),
            and(eq(auditLog.createdAt, new Date(cursor.createdAt)), lt(auditLog.id, cursor.id)),
          )
        : undefined;

      const rows = await db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          actorEmail: accounts.email,
          action: auditLog.action,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          meta: auditLog.meta,
          ip: auditLog.ip,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(accounts, eq(accounts.id, auditLog.actorId))
        .where(cursorClause)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(PAGE_SIZE);

      const csvRows = rows.map((r) => [
        r.id,
        r.actorId ?? '',
        r.actorEmail ?? '',
        r.action,
        r.targetType,
        r.targetId ?? '',
        JSON.stringify(r.meta ?? {}),
        r.ip ?? '',
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
