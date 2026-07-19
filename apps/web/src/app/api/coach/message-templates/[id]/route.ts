import { coachMessageTemplates } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — delete one of MY quick-reply templates (Pack K).
 *
 *  - DELETE → removes the template IF it belongs to the caller. The
 *             `coachId = me` predicate is the ownership guard: a coach can never
 *             delete another coach's template even by guessing its id (IDOR-safe).
 *
 * Guarded by requirePermission('coach.message.user').
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const deleted = await getDb()
    .delete(coachMessageTemplates)
    .where(
      and(eq(coachMessageTemplates.id, id), eq(coachMessageTemplates.coachId, principal.id)),
    )
    .returning({ id: coachMessageTemplates.id });

  if (deleted.length === 0) return json({ error: 'not_found' }, 404);
  await logAudit(principal, 'coach.template.delete', 'coach_message_template', id, {});

  return json({ ok: true }, 200);
}
