import { requirePermission } from '@/lib/authz';
import { json, preflight } from '@/lib/http';
import { loadSupportThreads, type SupportThreadStatus } from '@/lib/supportThreads';

export const runtime = 'nodejs';

/**
 * Admin console — support inbox: one row per account with any 'support'
 * thread activity (SCALE-UP-PLAN §4.4; lifecycle fields added for plan §3
 * P1-11).
 *
 *  GET /api/admin/support/threads?status=open|resolved|all&assignee=mine
 *    - DISTINCT ON (account) newest 'support' message per account, joined to
 *      the account's identity, each carrying `unread` — inbound (sender=
 *      'user') rows not yet `readByCoach` — plus the thread's LIFECYCLE state
 *      (`status`, `assignedTo`, `assignedToLabel`, `resolvedAt`) from the
 *      side-car `support_thread_states` row (absent row = implicitly 'open',
 *      unassigned). `unread` IS still "open work" at the message level;
 *      `status` is the separate ticket-workflow state (open/resolved) added
 *      on top — a resolved thread can still carry unread if the member
 *      replies again (no auto-reopen; staff explicitly reopens).
 *    - `status` optional filter, default 'all' here (the WEB console's
 *      SupportInbox fetches once and filters client-side instead, since this
 *      has never been a paginated endpoint); kept for other/future callers
 *      that want server-side filtering.
 *    - `assignee=mine` optional filter — keeps only threads assigned to the
 *      calling principal.
 *
 *  Query logic (DISTINCT ON + unread subquery + lifecycle join) now lives in
 *  @/lib/supportThreads, shared with the server page so both read the
 *  identical shape (was previously hand-duplicated — see plan §2 A7).
 *
 * Guarded by requirePermission('support.thread.read') — support_admin +
 * super/main_admin. Org-wide, no ownership scoping: support tickets are not
 * assigned to a specific coach (though they MAY be assigned to a specific
 * staff account via the lifecycle state).
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'support.thread.read');
  if (principal instanceof Response) return principal;

  const params = new URL(req.url).searchParams;
  const statusParam = params.get('status')?.trim();
  const status: SupportThreadStatus | 'all' =
    statusParam === 'open' || statusParam === 'resolved' ? statusParam : 'all';
  const assigneeId = params.get('assignee')?.trim() === 'mine' ? principal.id : undefined;

  const threads = await loadSupportThreads({ status, assigneeId });

  return json({ threads }, 200);
}
