import { coachMilestones } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — remove a milestone I logged (typo, wrong client). Strict
 * author check: only the AUTHORING coach may delete, and anything else 404s —
 * no oracle for other coaches' rows.
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({ id: coachMilestones.id, coachId: coachMilestones.coachId, accountId: coachMilestones.accountId })
    .from(coachMilestones)
    .where(eq(coachMilestones.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.coachId !== principal.id) return json({ error: 'not_found' }, 404);

  await db.delete(coachMilestones).where(eq(coachMilestones.id, id));

  await logAudit(principal, 'coach.milestone.delete', 'account', row.accountId, {
    milestoneId: id,
  });

  return json({ ok: true }, 200);
}
