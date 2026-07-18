import { coachChallenges } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin gamification oversight — remove a coach challenge (gap build P2-17).
 *
 *  - DELETE → removes the challenge. `challenge_members` FK is ON DELETE
 *    CASCADE, so joined members are removed too; a member who had already
 *    completed it keeps their earned `challenge:<id>` badge (awarded_badges
 *    has no FK to coach_challenges, by design — completions are permanent
 *    history even if the challenge definition is later moderated away).
 *
 * Guarded by requirePermission('gamification.manage').
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'gamification.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const deleted = await db
    .delete(coachChallenges)
    .where(eq(coachChallenges.id, id))
    .returning({ id: coachChallenges.id, coachId: coachChallenges.coachId, title: coachChallenges.title });

  const row = deleted[0];
  if (!row) return json({ error: 'not_found' }, 404);

  await logAudit(
    principal,
    'gamification.challenge_remove',
    'coach_challenge',
    row.id,
    { coachId: row.coachId, title: row.title },
    clientIp(req),
  );

  return json({ id: row.id }, 200);
}
