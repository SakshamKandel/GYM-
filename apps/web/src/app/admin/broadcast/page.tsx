import { accounts, auditLog } from '@gym/db';
import { and, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { BroadcastComposer, type BroadcastHistoryRow } from './_components/BroadcastComposer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin broadcast page (gap build P0-4). Compose + send a push announcement to
 * all members (optionally filtered by tier/country), and review recent sends.
 *
 * Gated on `broadcast.send` — super_admin / main_admin only. The layout hides
 * the nav link for anyone else, but we re-check here so a direct URL fails safe,
 * matching the other admin pages. Send itself goes through the guarded
 * POST /api/admin/broadcast (the httpOnly gt_staff cookie rides along).
 *
 * "History" is derived from the audit log: every send writes a `broadcast.send`
 * row with the title + recipient count in its meta, so we read the recent ones
 * back here rather than maintaining a separate broadcasts table.
 */

/** Recent broadcast.send audit rows → the history list. */
async function loadHistory(): Promise<BroadcastHistoryRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: auditLog.id,
      meta: auditLog.meta,
      createdAt: auditLog.createdAt,
      actorEmail: accounts.email,
    })
    .from(auditLog)
    .leftJoin(accounts, eq(accounts.id, auditLog.actorId))
    .where(and(eq(auditLog.action, 'broadcast.send'), eq(auditLog.targetType, 'broadcast')))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(25);

  return rows.map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const asNum = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const asStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    return {
      id: r.id,
      title: asStr(meta.title) ?? '(untitled)',
      tier: asStr(meta.tier),
      country: asStr(meta.country),
      recipients: asNum(meta.recipients),
      delivered: asNum(meta.delivered),
      sentBy: r.actorEmail ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export default async function AdminBroadcastPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('broadcast.send')) redirect('/admin');

  const history = await loadHistory();

  return (
    <div style={{ maxWidth: 860 }}>
      <PageHeader
        title="Broadcast"
        subtitle="Send a push announcement to members. Optionally target a single membership tier or country. Every send is recorded below."
      />
      <BroadcastComposer initialHistory={history} />
    </div>
  );
}
