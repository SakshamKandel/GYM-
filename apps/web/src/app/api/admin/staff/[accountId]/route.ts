import { admins, sessions } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — revoke a staff role.
 *
 *  - DELETE → removes the account's `admins` row (revoking all staff access) AND
 *             deletes every one of that account's `sessions`, so any live token
 *             (console cookie or mobile Bearer) dies instantly instead of
 *             lingering until expiry. 404 if the account was not staff.
 *
 * Guarded by requirePermission('roles.grant') — super_admin only — and audited.
 * A super_admin cannot revoke their OWN role here (self-lockout guard); they
 * must have another super_admin do it.
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const principal = await requirePermission(req, 'roles.grant');
  if (principal instanceof Response) return principal;

  const { accountId } = await params;

  // Self-lockout guard: refuse to strip the caller's own staff access, which
  // would immediately kill their session and lock them out of the console.
  if (accountId === principal.id) {
    return json({ error: 'cannot_revoke_self' }, 400);
  }

  const db = getDb();

  const deleted = await db
    .delete(admins)
    .where(eq(admins.accountId, accountId))
    .returning({ accountId: admins.accountId, role: admins.role });

  if (deleted.length === 0) {
    return json({ error: 'not_staff' }, 404);
  }

  // Kill every live session for this account so revoked access takes effect now.
  await db.delete(sessions).where(eq(sessions.accountId, accountId));

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(
    principal,
    'roles.revoke',
    'account',
    accountId,
    { role: deleted[0].role },
    ip,
  );

  return json({ ok: true }, 200);
}
