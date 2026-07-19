import { accounts, auditLog } from '@gym/db';
import { and, desc, eq, ilike, lt, or, type SQL } from 'drizzle-orm';
import { csvStreamResponse, dateStampedFilename } from '@/lib/csv';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — audit-log CSV export (plan §3 P1-10; filter-honoring fix,
 * console-scale wave N8).
 *
 *  GET /api/admin/exports/audit?action=&actor= → the audit trail matching the
 *  SAME `action` (exact) / `actor` (email substring) filters the audit page's
 *  `AuditTable` currently has applied, newest first, streamed as CSV. Same
 *  (createdAt, id) keyset tuple + ordering as GET /api/admin/audit, walked
 *  internally in PAGE_SIZE batches so the response streams rather than
 *  buffering the whole log in memory. `meta` is JSON-stringified into a
 *  single field (it is an arbitrary object per action, so there is no fixed
 *  column set to flatten it into). Both filters are optional — an export with
 *  neither set is the full trail, as before.
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

  const params = new URL(req.url).searchParams;
  const action = params.get('action')?.trim() || null;
  const actor = params.get('actor')?.trim() || null;

  // Same filter semantics as GET /api/admin/audit: `action` exact, `actor`
  // case-insensitive substring on the joined actor email. Built once — these
  // don't change per page, only the keyset cursor clause does.
  const staticClauses: SQL[] = [];
  if (action) staticClauses.push(eq(auditLog.action, action));
  if (actor) staticClauses.push(ilike(accounts.email, `%${actor}%`));

  const db = getDb();
  // Actions are internal dotted identifiers (e.g. 'coach.assign'), but the
  // value still round-trips through a query param — sanitize before it lands
  // in a Content-Disposition header so no unexpected character can leak in.
  const safeAction = action ? action.replace(/[^a-zA-Z0-9._-]/g, '-') : null;
  const filenameBase = safeAction ? `audit-log-${safeAction}` : 'audit-log';

  const stream = csvStreamResponse<Cursor>(
    dateStampedFilename(filenameBase),
    HEADER,
    async (cursor) => {
      const cursorClause = cursor
        ? or(
            lt(auditLog.createdAt, new Date(cursor.createdAt)),
            and(eq(auditLog.createdAt, new Date(cursor.createdAt)), lt(auditLog.id, cursor.id)),
          )
        : undefined;
      const clauses = cursorClause ? [...staticClauses, cursorClause] : staticClauses;

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
        .where(clauses.length ? and(...clauses) : undefined)
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
