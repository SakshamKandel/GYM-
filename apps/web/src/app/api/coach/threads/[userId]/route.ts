import { coachMessages } from '@gym/db';
import { and, desc, eq } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — one user's coach_chat thread (the human side of the mobile
 * Elite chat).
 *
 *  - GET → that user's 'coach_chat' messages oldest → newest. PURE READ — it no
 *          longer mutates. Marking the thread read moved to the sibling POST
 *          `.../read` route (defect F2): the old GET side-effect was reachable
 *          via a SameSite=Lax top-level navigation, so a GET-CSRF could silently
 *          clear the coach's unread badge (unread IS the work queue). Reads must
 *          not have side effects.
 *
 * Guards (both must pass, fail closed):
 *   requirePermission('coach.message.user')  — caller is staff with the perm
 *   requireCoachOwnsUser(principal, userId)   — active assignment (super_admin
 *                                               bypasses); 403 otherwise.
 */

/**
 * Newest N rows returned for the polled thread. MessageList polls this route
 * every 10s and replaces its whole message array, so an unbounded SELECT would
 * re-fetch the entire history every tick and hold it all in client state
 * (P1-12). Matches the RSC page's first-paint HISTORY_LIMIT.
 */
const HISTORY_LIMIT = 100;

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const db = getDb();

  const rows = await db
    .select({
      id: coachMessages.id,
      kind: coachMessages.kind,
      sender: coachMessages.sender,
      body: coachMessages.body,
      senderAccountId: coachMessages.senderAccountId,
      readByUser: coachMessages.readByUser,
      readByCoach: coachMessages.readByCoach,
      createdAt: coachMessages.createdAt,
    })
    .from(coachMessages)
    .where(and(eq(coachMessages.accountId, userId), eq(coachMessages.kind, 'coach_chat')))
    .orderBy(desc(coachMessages.createdAt))
    .limit(HISTORY_LIMIT);
  // Fetched newest-first for the cap; flip back to chronological for the client,
  // which renders oldest → newest.
  rows.reverse();

  return json({ messages: rows }, 200);
}
