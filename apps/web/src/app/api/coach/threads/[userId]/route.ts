import { coachMessages } from '@gym/db';
import { and, asc, eq } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — one user's coach_chat thread (the human side of the mobile
 * Elite chat).
 *
 *  - GET → that user's 'coach_chat' messages oldest → newest, then marks the
 *          inbound (sender='user') rows as read (read_by_coach = true) so the
 *          console's unread badge clears on open.
 *
 * Guards (both must pass, fail closed):
 *   requirePermission('coach.message.user')  — caller is staff with the perm
 *   requireCoachOwnsUser(principal, userId)   — active assignment (super_admin
 *                                               bypasses); 403 otherwise.
 */

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
    .orderBy(asc(coachMessages.createdAt));

  // Clear the coach-side unread flag on the inbound rows we just served. Done
  // after the read so the returned payload still reflects pre-read state is
  // irrelevant to the console (it renders all rows regardless); a fresh
  // /users fetch will show the badge cleared.
  await db
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

  return json({ messages: rows }, 200);
}
