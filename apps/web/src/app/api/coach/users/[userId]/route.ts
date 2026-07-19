import { coachAssignments } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { notify } from '@/lib/notify';

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
 *
 * B21: the mobile flows push the member on accept/decline but the unassign was
 * SILENT — the member's coach vanished with no notice. On a real end (≥1 active
 * row flipped), fire a best-effort `coach_unassigned` notification (WP-2 / Pack
 * L) so the app can surface an unassign banner + inbox row. Fire-and-forget:
 * never blocks or fails the release. Title/body are server-templated — no
 * member-authored text is echoed, so no maskPii step is needed here.
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

  const ended = await getDb()
    .update(coachAssignments)
    .set({ status: 'ended' })
    .where(
      and(
        eq(coachAssignments.coachId, principal.id),
        eq(coachAssignments.userId, userId),
        eq(coachAssignments.status, 'active'),
      ),
    )
    .returning({ id: coachAssignments.id });

  await logAudit(principal, 'coach.unassign', 'account', userId, {});

  // Only notify when an assignment was actually live — a no-op DELETE (already
  // ended, or admin acting without a row) must not tell the member their coach
  // left. WP-13 consumes `coach_unassigned` for the member-side banner.
  if (ended.length > 0) {
    void notify(
      'coach_unassigned',
      { accountId: userId },
      {
        title: 'Coaching update',
        body: 'Your coaching assignment has ended. You can request a new coach whenever you are ready.',
        data: { type: 'coach' },
      },
    );
  }

  return json({ ok: true }, 200);
}
