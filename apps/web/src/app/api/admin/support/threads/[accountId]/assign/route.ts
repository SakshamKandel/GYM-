import { accounts, admins, supportThreadStates } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

const bodySchema = z.object({ assigneeId: z.string().min(1).nullable() });

/**
 * Admin console — assign (or unassign) a support thread to a staff account
 * (plan §3 P1-11). `assigneeId: null` unassigns. A non-null `assigneeId` must
 * resolve to an EXISTING STAFF account (an `admins` row) — assigning a ticket
 * to a plain member would be nonsensical and would leak into their "assigned
 * to me" surface if one is ever built for members, so this fails closed with
 * 400 `invalid_assignee` rather than trusting an arbitrary accountId. The web
 * console's own UI only offers "assign to me" / "unassign" today, but the
 * route accepts any valid staff id so a future picker needs no API change.
 *
 * Guarded by requirePermission('support.thread.reply') — same gate as
 * resolve/reopen/reply. Audited as 'support.assign' with the resulting
 * assigneeId (null on unassign) in `meta`.
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

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { assigneeId } = parsed.data;

  const db = getDb();

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) return json({ error: 'not_found' }, 404);

  if (assigneeId !== null) {
    const [staffRow] = await db
      .select({ accountId: admins.accountId })
      .from(admins)
      .where(eq(admins.accountId, assigneeId))
      .limit(1);
    if (!staffRow) return json({ error: 'invalid_assignee' }, 400);
  }

  const now = new Date();
  await db
    .insert(supportThreadStates)
    .values({ accountId, assignedTo: assigneeId, updatedAt: now })
    .onConflictDoUpdate({
      target: supportThreadStates.accountId,
      set: { assignedTo: assigneeId, updatedAt: now },
    });

  await logAudit(principal, 'support.assign', 'account', accountId, { assigneeId });

  return json({ ok: true }, 200);
}
