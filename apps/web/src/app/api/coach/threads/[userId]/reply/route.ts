import { coachMessages } from '@gym/db';
import { maskPii } from '@gym/shared';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';

export const runtime = 'nodejs';

/**
 * Coach console — the human coach's reply into a user's coach_chat thread.
 *
 *  - POST {text} → inserts a 'coach' row authored by the caller
 *                  (senderAccountId = me), unread by the user, read by the
 *                  coach. Deliberately does NOT call greeceCoachReply(): this
 *                  IS the human answer. The mobile MessageBubble renders any
 *                  sender!='user' row on the left as a "Greece" message, so
 *                  this appears with zero mobile changes.
 *
 * Guards (both, fail closed): requirePermission('coach.message.user') +
 * requireCoachOwnsUser(principal, userId) → 403 if not owned.
 */

const postSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

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

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  // Masked BEFORE storage — the in-app-contact policy binds coaches too.
  const body = maskPii(parsed.data.body);

  const db = getDb();

  const inserted = await db
    .insert(coachMessages)
    .values({
      accountId: userId,
      kind: 'coach_chat',
      sender: 'coach',
      senderAccountId: principal.id,
      body,
      readByUser: false,
      readByCoach: true,
    })
    .returning({
      id: coachMessages.id,
      kind: coachMessages.kind,
      sender: coachMessages.sender,
      body: coachMessages.body,
      senderAccountId: coachMessages.senderAccountId,
      readByUser: coachMessages.readByUser,
      readByCoach: coachMessages.readByCoach,
      createdAt: coachMessages.createdAt,
    });

  const message = inserted[0];
  if (!message) return json({ error: 'invalid' }, 400);

  // Best-effort notify (WP-2 / Pack K): writes the member's durable inbox row +
  // respects their prefs/quiet-hours, then pushes. Fire-and-forget — never
  // blocks or fails the reply. The body is already maskPii'd above; the coach is
  // the author, so it is the member's own coach speaking (no cross-user leak).
  void notify(
    'coach_message_client',
    { accountId: userId },
    {
      title: 'New message from your coach',
      body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
      data: { type: 'coach_chat', id: userId },
    },
  );

  await logAudit(principal, 'coach.reply', 'account', userId, { len: body.length });

  return json({ message }, 201);
}
