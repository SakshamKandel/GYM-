import { coachMilestones } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — moderator removal of a coach_milestones row
 * (ADMIN-MASTER-PLAN §3 P1-9). The schema carries no soft-remove flag on this
 * table (no `status`/`removed` column), so this is a hard delete — same as the
 * coach's own-row DELETE /api/coach/milestones/[id], just without the
 * coachId===principal.id author restriction, and always audited so the removal
 * is traceable even though the row itself is gone.
 *
 * Guarded by requirePermission('moderation.manage').
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'moderation.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({
      id: coachMilestones.id,
      coachId: coachMilestones.coachId,
      accountId: coachMilestones.accountId,
      title: coachMilestones.title,
    })
    .from(coachMilestones)
    .where(eq(coachMilestones.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  await db.delete(coachMilestones).where(eq(coachMilestones.id, id));

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(
    principal,
    'moderation.milestone.remove',
    'account',
    row.accountId,
    { milestoneId: id, coachId: row.coachId, title: row.title },
    ip,
  );

  return json({ ok: true }, 200);
}
