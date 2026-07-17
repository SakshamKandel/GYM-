import { accounts, auditLog } from '@gym/db';
import { desc, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { AuditTable, type AuditEntry } from './_components/AuditTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * Loads page 1 of the audit trail directly via getDb so the first paint has
 * data with no client round-trip. Shape MUST match GET /api/admin/audit's
 * `entries` (same fields, createdAt as ISO string) so later client fetches
 * append seamlessly. Ordering is (createdAt DESC, id DESC) — the same stable
 * keyset the API pages on. Fetches PAGE_SIZE+1 to derive the initial cursor.
 */
async function loadFirstPage(): Promise<{ entries: AuditEntry[]; cursor: string | null }> {
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
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  const cursor = hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null;

  const entries: AuditEntry[] = page.map((r) => ({
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

  return { entries, cursor };
}

/**
 * Distinct set of actions currently in the log, ascending, to seed the filter
 * dropdown — so it only ever offers filters that can match a row.
 */
async function loadDistinctActions(): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .orderBy(sql`${auditLog.action} asc`);
  return rows.map((r) => r.action);
}

/**
 * Audit log page — super_admin + main_admin (audit VIEW is part of
 * main_admin's full permission set; rank only limits who they can TARGET).
 * The admin layout already hides the nav link for other roles, but we re-check
 * here server-side so hitting the URL directly still fails safe (mirrors the
 * pattern in admin/coaches/page.tsx).
 */
export default async function AdminAuditPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('audit.read')) redirect('/admin');

  const [{ entries, cursor }, actions] = await Promise.all([
    loadFirstPage(),
    loadDistinctActions(),
  ]);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Audit log"
        subtitle="Every staff action, newest first. Filter by action or actor email."
      />
      <AuditTable initialEntries={entries} initialCursor={cursor} actions={actions} />
    </div>
  );
}
