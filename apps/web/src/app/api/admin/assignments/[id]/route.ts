import { coachAssignments } from '@gym/db';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { notify } from '@/lib/notify';

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

  // Did this DELETE end a LIVE assignment? Only then has the member really lost
  // a coach and earned a notice. Read the pre-state first: `.returning()` below
  // reports the row AFTER the flip, so 'ended' there says nothing about what the
  // row was a moment ago. The update itself is left exactly as it was — same
  // unconditional where, same 200-vs-404 semantics, same response shape.
  const before = await db
    .select({ status: coachAssignments.status })
    .from(coachAssignments)
    .where(eq(coachAssignments.id, id))
    .limit(1);
  const endedLive = before[0]?.status === 'active';

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

  // The coach-side release (DELETE /api/coach/users/[userId]) notifies the
  // member; the ADMIN unassign was silent, so a member's coach vanished with no
  // notice. Same event + copy as that route. Only on a real end — re-ending an
  // already-ended row must never tell the member their coach left.
  if (endedLive) {
    after(() =>
      notify(
        'coach_unassigned',
        { accountId: assignment.userId },
        {
          title: 'Coaching update',
          body: 'Your coaching assignment has ended. You can request a new coach whenever you are ready.',
          data: { type: 'coach' },
        },
      ),
    );
  }

  return json({ assignment }, 200);
}
