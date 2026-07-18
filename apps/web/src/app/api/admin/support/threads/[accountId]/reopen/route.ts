import { accounts, supportThreadStates } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — reopen a resolved support thread (plan §3 P1-11). Clears
 * `resolvedBy`/`resolvedAt` and flips `status` back to 'open', returning the
 * thread to the inbox's default queue. Upsert for the same lazy-row reason as
 * .../resolve (a thread reopened before ever being explicitly resolved is
 * already 'open' — this is a harmless no-op in that case).
 *
 * Guarded by requirePermission('support.thread.reply') — same gate as
 * resolve/reply. Audited as 'support.reopen'.
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
    .values({ accountId, status: 'open', resolvedBy: null, resolvedAt: null, updatedAt: now })
    .onConflictDoUpdate({
      target: supportThreadStates.accountId,
      set: { status: 'open', resolvedBy: null, resolvedAt: null, updatedAt: now },
    });

  await logAudit(principal, 'support.reopen', 'account', accountId, {});

  return json({ ok: true }, 200);
}
