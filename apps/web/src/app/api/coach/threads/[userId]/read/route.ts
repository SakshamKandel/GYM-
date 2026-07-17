import { coachMessages } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — mark one user's coach_chat thread read (defect F2).
 *
 *  - POST → clears the coach-side unread flag (read_by_coach = true) on the
 *           inbound (sender='user') rows of that user's 'coach_chat' thread.
 *
 * This is the write half split out of the old GET side-effect: marking read is
 * a MUTATION, so it lives behind an explicit POST that a SameSite=Lax top-level
 * navigation (a GET-CSRF) can't reach. The client calls it deliberately after
 * the coach opens the thread. Idempotent — re-POSTing on an already-read thread
 * is a no-op.
 *
 * Guards (both must pass, fail closed):
 *   requirePermission('coach.message.user')  — caller is staff with the perm
 *   requireCoachOwnsUser(principal, userId)   — active assignment (super_admin
 *                                               bypasses); 403 otherwise.
 */

export function OPTIONS() {
  return preflight();
}

export async function POST(
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
    .update(coachMessages)
    .set({ readByCoach: true })
    .where(
      and(
        eq(coachMessages.accountId, userId),
        eq(coachMessages.kind, 'coach_chat'),
        eq(coachMessages.sender, 'user'),
        eq(coachMessages.readByCoach, false),
      ),
    );

  return json({ ok: true }, 200);
}
