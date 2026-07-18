import { accounts, sessions } from '@gym/db';
import { eq } from 'drizzle-orm';
import {
  adminRoleOf,
  logAudit,
  requireOutranks,
  requirePermission,
} from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * DELETE /api/admin/members/[id]/sessions — force sign-out everywhere (P1-7,
 * gated `members.manage_credentials`). Deletes every session row for the
 * account, instantly invalidating all live bearer tokens / console cookies
 * (userForToken/staffForToken filter on a matching session). Unlike suspension,
 * the account stays 'active' — the member (or the admin who compromised-token
 * cleaned it) can sign back in immediately with their existing password.
 *
 * Rank-guarded for staff targets: a lower-ranked staffer cannot revoke a
 * peer/higher admin's sessions.
 */

function getIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(req, 'members.manage_credentials');
  if (actor instanceof Response) return actor;

  const { id } = await ctx.params;
  const db = getDb();

  const targetRole = await adminRoleOf(id);
  const rankBlock = requireOutranks(actor, targetRole);
  if (rankBlock) return rankBlock;

  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  if (rows.length === 0) return json({ error: 'not_found' }, 404);

  const revoked = await db
    .delete(sessions)
    .where(eq(sessions.accountId, id))
    .returning({ token: sessions.token });

  await logAudit(
    actor,
    'member.force_signout',
    'account',
    id,
    { revoked: revoked.length },
    getIp(req),
  );

  return json({ ok: true, revoked: revoked.length }, 200);
}
