import { coachAssignments } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — release a client from MY roster.
 *
 *  - DELETE → ends the caller's own active assignment over the user (rows are
 *             ended, never deleted — the pair's history survives and the
 *             unique index lets a future accept reactivate it).
 *
 * Guards (both, fail closed): requirePermission('coach.message.user') +
 * requireCoachOwnsUser(principal, userId) → 403 if not owned.
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  await getDb()
    .update(coachAssignments)
    .set({ status: 'ended' })
    .where(
      and(
        eq(coachAssignments.coachId, principal.id),
        eq(coachAssignments.userId, userId),
        eq(coachAssignments.status, 'active'),
      ),
    );

  await logAudit(principal, 'coach.unassign', 'account', userId, {});

  return json({ ok: true }, 200);
}
