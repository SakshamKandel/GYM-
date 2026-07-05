import { checkIns, coachMessages } from '@gym/db';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — reply to a member's weekly check-in.
 *
 *  - POST {body} → inserts a 'coach' row into the member's coach_chat thread
 *    (senderAccountId = me, unread by the user, read by the coach) and links
 *    it back via check_ins.coachReplyMessageId. The reply lives in the SAME
 *    thread the mobile app already renders, so it appears with zero mobile
 *    changes; the check-in row just gains its "replied" state.
 *
 * Push is best-effort via after() (sendPushToAccount never throws and no-ops
 * without FIREBASE_SERVICE_ACCOUNT_B64) — the thread row IS the record.
 *
 * Guards (both, fail closed): requirePermission('coach.message.user') +
 * requireCoachOwnsUser(principal, checkIn.accountId) — the member comes from
 * the check-in ROW, never from the request.
 */

const postSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({ id: checkIns.id, accountId: checkIns.accountId })
    .from(checkIns)
    .where(eq(checkIns.id, id))
    .limit(1);
  const checkIn = rows[0];
  if (!checkIn) return json({ error: 'not_found' }, 404);

  if (!(await requireCoachOwnsUser(principal, checkIn.accountId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { body } = parsed.data;

  const inserted = await db
    .insert(coachMessages)
    .values({
      accountId: checkIn.accountId,
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

  await db
    .update(checkIns)
    .set({ coachReplyMessageId: message.id })
    .where(eq(checkIns.id, checkIn.id));

  // Best-effort notify; never blocks or fails the reply. Wrapped in after()
  // so the serverless runtime keeps the FCM send alive past the response
  // instead of freezing it mid-flight. Generic copy on purpose: check-in
  // replies routinely quote health details (bodyweight, injuries), which must
  // not appear on the lock screen — the full text arrives in-app via
  // hydrateCheckIns() triggered by data.type 'checkin_reply'.
  after(() => sendPushToAccount(checkIn.accountId, {
    title: 'Your coach replied',
    body: 'Your coach replied to your check-in.',
    data: { type: 'checkin_reply', checkInId: checkIn.id },
  }));

  await logAudit(principal, 'coach.checkin.reply', 'check_in', checkIn.id, {
    userId: checkIn.accountId,
    len: body.length,
  });

  return json({ message }, 201);
}
