import { accounts, supportThreadStates } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — mark a support thread resolved (plan §3 P1-11). The
 * `support_thread_states` row is created lazily (per schema.ts docblock): a
 * thread with no prior lifecycle row didn't exist as an explicit record until
 * now, so this is an upsert, not an update. Setting `status='resolved'` moves
 * the thread out of the inbox's default (Open) queue — `unread` at the
 * message level is unaffected, so a member reply after resolution still
 * shows as unread on the (now off-queue) thread until staff reopens it.
 *
 * Guarded by requirePermission('support.thread.reply') — same permission the
 * inbox already requires to act on a thread (reply), not the read-only
 * 'support.thread.read'. Audited as 'support.resolve'.
 */

export function OPTIONS() {
  return preflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const principal = await requirePermission(req, 'support.thread.reply');
  if (principal instanceof Response) return principal;

  const { accountId } = await params;

  const [account] = await getDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) return json({ error: 'not_found' }, 404);

  const now = new Date();
  await getDb()
    .insert(supportThreadStates)
    .values({
      accountId,
      status: 'resolved',
      resolvedBy: principal.id,
      resolvedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: supportThreadStates.accountId,
      set: { status: 'resolved', resolvedBy: principal.id, resolvedAt: now, updatedAt: now },
    });

  await logAudit(principal, 'support.resolve', 'account', accountId, {});

  return json({ ok: true }, 200);
}
