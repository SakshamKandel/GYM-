import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { loadSupportThreads } from '@/lib/supportThreads';
import { SupportInbox } from './_components/SupportInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to view the support inbox. Mirrors the 'support.thread.read'
 * grant in authz.ts (support_admin + super/main_admin). The admin layout
 * already hides the nav link and guards the subtree, but we re-check here so
 * hitting the URL directly still fails safe.
 *
 * Thread loading (the query, unread subquery, lifecycle-state join) lives in
 * @/lib/supportThreads — shared with GET /api/admin/support/threads so the
 * server-rendered first paint and the client's later fetches read the
 * identical shape (deliberate; see the lib file's docblock).
 */

export default async function AdminSupportPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('support.thread.read')) redirect('/admin');
  // Replying, resolving, reopening and assigning all hit routes guarded by
  // `support.thread.reply` — a stricter permission than the read grant that
  // opens this page. Deriving it here and disabling those controls when it is
  // absent (e.g. stripped by a DENY override) kills the 403-trap where a
  // read-only support viewer could type a reply that the API rejects (P1-3).
  const canReply = permissions.has('support.thread.reply');

  // Full set (both open and resolved) — the inbox's Open/Resolved/Mine tabs
  // filter this client-side (no pagination here, matching the endpoint's
  // long-standing full-table-scan shape), and the stat tiles below need the
  // resolved count regardless of which tab is showing.
  const threads = await loadSupportThreads({ status: 'all' });
  const openThreads = threads.filter((t) => t.status === 'open');
  const resolvedCount = threads.length - openThreads.length;
  const awaiting = openThreads.filter((t) => t.unread > 0).length;
  const totalUnread = threads.reduce((sum, t) => sum + t.unread, 0);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Support"
        subtitle="Every account with a support ticket, unread first. Open a thread to read, reply, assign, or resolve it."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Open" value={openThreads.length} />
        <StatTile
          label="Awaiting reply"
          value={awaiting}
          hint={awaiting === 0 ? 'all clear' : undefined}
        />
        <StatTile label="Unread messages" value={totalUnread} />
        <StatTile label="Resolved" value={resolvedCount} />
      </div>

      <SupportInbox threads={threads} viewerId={principal.id} canReply={canReply} />
    </div>
  );
}
