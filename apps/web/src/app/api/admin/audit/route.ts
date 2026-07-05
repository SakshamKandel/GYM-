import { accounts, auditLog } from '@gym/db';
import { and, desc, eq, ilike, lt, or } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — the audit trail.
 *
 *  GET /api/admin/audit?action=&actor=&cursor=
 *    - `action`  → exact-match filter on audit_log.action (dropdown of known actions).
 *    - `actor`   → case-insensitive substring match on the actor's email
 *                  (joined accounts.email). Rows whose actorId is null / actor
 *                  account was deleted never match an actor filter.
 *    - `cursor`  → keyset page token: "<createdAtISO>|<id>". Returns rows
 *                  strictly OLDER than the cursor tuple, newest-first.
 *
 *  Ordering is (createdAt DESC, id DESC) so ties on createdAt are deterministic
 *  and the (createdAt,id) tuple is a stable keyset. Page size is PAGE_SIZE; the
 *  response carries `nextCursor` (or null when the last page is reached).
 *
 * Guarded by requirePermission('audit.read') — super_admin + main_admin only
 * (both bypass the permission matrix; audit.read is granted to no other role
 * and falls through fail-closed).
 */

const PAGE_SIZE = 50;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'audit.read');
  if (principal instanceof Response) return principal;

  const params = new URL(req.url).searchParams;
  const action = params.get('action')?.trim() || null;
  const actor = params.get('actor')?.trim() || null;
  const cursor = params.get('cursor')?.trim() || null;

  const conditions = [];

  if (action) conditions.push(eq(auditLog.action, action));
  if (actor) conditions.push(ilike(accounts.email, `%${actor}%`));

  // Keyset: rows strictly older than the cursor tuple (createdAt, id).
  // "createdAt < cur.createdAt OR (createdAt = cur.createdAt AND id < cur.id)".
  if (cursor) {
    const sep = cursor.lastIndexOf('|');
    if (sep > 0) {
      const createdRaw = cursor.slice(0, sep);
      const idRaw = cursor.slice(sep + 1);
      const created = new Date(createdRaw);
      if (!Number.isNaN(created.getTime()) && idRaw) {
        conditions.push(
          or(
            lt(auditLog.createdAt, created),
            and(eq(auditLog.createdAt, created), lt(auditLog.id, idRaw)),
          ),
        );
      }
    }
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const db = getDb();
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      meta: auditLog.meta,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
      actorId: auditLog.actorId,
      actorEmail: accounts.email,
    })
    .from(auditLog)
    .leftJoin(accounts, eq(accounts.id, auditLog.actorId))
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    // Fetch one extra row to know whether a further page exists.
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null;

  const entries = page.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    meta: r.meta,
    ip: r.ip,
    createdAt: r.createdAt.toISOString(),
    actorId: r.actorId,
    actorEmail: r.actorEmail ?? null,
  }));

  return json({ entries, nextCursor }, 200);
}
