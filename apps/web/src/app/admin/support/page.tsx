import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader, SkeletonRows, SkeletonTiles, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { loadSupportThreads } from '@/lib/supportThreads';
import { SupportInbox } from './_components/SupportInbox';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Support' };
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
 * identical shape (deliberate; see the lib file's docblock). That lib also
 * owns the ORDER, which is where the Elite "answered first" promise is made
 * true, and the per-row `priority` flag the badge and the tile below read.
 */

/** Tiles + inbox while the (unpaginated) thread read is still in flight. */
function QueueSkeleton() {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <SkeletonTiles count={4} />
      </div>
      <SkeletonRows rows={8} cols={4} />
    </>
  );
}

/**
 * Everything that needs the thread list. Split out so it can sit behind a
 * Suspense boundary: the read is a full-table scan of every ticket, and until
 * now the page title and the whole console frame waited on it. The shell paints
 * first, the queue streams in after.
 */
async function SupportQueue({
  viewerId,
  canReply,
  canViewMembers,
}: {
  viewerId: string;
  canReply: boolean;
  canViewMembers: boolean;
}) {
  // Full set (both open and resolved) — the inbox's Open/Resolved/Mine tabs
  // filter this client-side (no pagination here, matching the endpoint's
  // long-standing full-table-scan shape), and the stat tiles below need the
  // resolved count regardless of which tab is showing.
  const threads = await loadSupportThreads({ status: 'all' });
  // Same open-queue predicate the inbox's Open tab uses (status OR unread): a
  // member replying to a resolved ticket puts it back on the queue, and the
  // unread reply is the work signal even if the lifecycle row lags. Counting
  // only status==='open' here made the tiles disagree with the tab beneath
  // them and hid follow-ups on closed tickets from the "Awaiting reply" count.
  const openThreads = threads.filter((t) => t.status === 'open' || t.unread > 0);
  const resolvedCount = threads.length - openThreads.length;
  const awaiting = openThreads.filter((t) => t.unread > 0).length;
  const totalUnread = threads.reduce((sum, t) => sum + t.unread, 0);
  // Elite pays for a place at the front of the line, so how many of them are
  // still waiting is the number this team is judged on. Same `priority` flag
  // that sorts the list and badges the rows.
  const priorityWaiting = openThreads.filter((t) => t.priority && t.unread > 0).length;

  return (
    <>
      {/* Four numbers, in the order an operator asks for them: what is waiting
          on us, who is owed an answer first, how much is still open, how much
          is done. The unread total rides along as a hint rather than taking a
          fifth tile and squeezing every number narrower. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile
          label="Waiting on a reply"
          value={awaiting}
          hint={
            awaiting === 0
              ? 'All clear'
              : `${totalUnread} unread ${totalUnread === 1 ? 'message' : 'messages'}`
          }
        />
        <StatTile
          label="Elite waiting"
          value={priorityWaiting}
          hint={priorityWaiting > 0 ? 'Answer these first' : 'All clear'}
        />
        <StatTile label="Open tickets" value={openThreads.length} />
        <StatTile label="Resolved" value={resolvedCount} />
      </div>

      <SupportInbox
        threads={threads}
        viewerId={viewerId}
        canReply={canReply}
        canViewMembers={canViewMembers}
      />
    </>
  );
}

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

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Support"
        subtitle="The ticket at the top is the one to answer next: waiting longest comes first, and Elite members come before the rest."
      />

      <Suspense fallback={<QueueSkeleton />}>
        <SupportQueue
          viewerId={principal.id}
          canReply={canReply}
          canViewMembers={permissions.has('members.read')}
        />
      </Suspense>
    </div>
  );
}
