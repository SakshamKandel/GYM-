import { coachAssignments } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — end a coach ↔ member assignment.
 *
 *  - DELETE → soft-ends the row (status='ended') by id, keeping the audit trail
 *             and the unique (coachId,userId) pairing so it can be reassigned.
 *             404 if no such assignment id.
 *
 * Guarded by requirePermission('coach.assign'); super_admin passes too.
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePermission(req, 'coach.assign');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const updated = await db
    .update(coachAssignments)
    .set({ status: 'ended' })
    .where(eq(coachAssignments.id, id))
    .returning({
      id: coachAssignments.id,
      coachId: coachAssignments.coachId,
      userId: coachAssignments.userId,
      status: coachAssignments.status,
    });

  const assignment = updated[0];
  if (!assignment) return json({ error: 'not_found' }, 404);

  await logAudit(principal, 'coach.unassign', 'account', assignment.userId, {
    coachId: assignment.coachId,
    assignmentId: assignment.id,
  });

  return json({ assignment }, 200);
}
