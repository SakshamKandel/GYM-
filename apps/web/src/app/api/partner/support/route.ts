import { coachMessages, mealPartners, supportThreadStates } from '@gym/db';
import { maskPii } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { loadPartnerSupportThread } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * The restaurant's own line to the platform team.
 *
 * The portal used to tell partners to "contact admin support". There was no
 * such thing for them: support is opened from inside the member app, and a
 * restaurant does not have one. So the instruction pointed at nothing, which is
 * the worst kind of help copy.
 *
 * Rather than invent a second queue nobody would remember to watch, this writes
 * into the SAME `coach_messages` support thread the staff inbox already lists,
 * keyed by the partner's own account. Staff read, assign, reply and resolve it
 * with the tools they already use; the reply comes back to this thread, and the
 * portal's alert dock tells the restaurant it arrived (there is no device to
 * push to, so the open tab is the only place a partner can be reached).
 *
 *  - GET  → the whole thread, oldest first. Read-only: marking replies as read
 *           is a separate POST (a mutating GET is reachable from a plain link
 *           and would silently clear the unread state).
 *  - POST → one message from the restaurant. Also puts a resolved ticket back
 *           on the staff queue, exactly as a member reply does, so a follow-up
 *           can never land in a closed thread nobody looks at.
 */

const postSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;

  const messages = await loadPartnerSupportThread(getDb(), guard.principal.id);
  return json({ messages }, 200);
}

export async function POST(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { principal, partnerId } = guard;

  const limited = rateLimit({
    route: 'partner/support',
    limit: 5,
    windowMs: 60_000,
    accountId: principal.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const body = parsed.data.body;

  const db = getDb();

  // Stored as written. This is first-party support: a restaurant quoting its
  // own phone number, a rider's number or a customer's building name is doing
  // the job, and masking it would make the ticket unanswerable. The staff
  // notification below is still masked, because that text lands on a lock
  // screen, and because free text from one account must never be able to look
  // like platform-authored copy to a privileged reader.
  const inserted = await db
    .insert(coachMessages)
    .values({
      accountId: principal.id,
      kind: 'support',
      sender: 'user',
      senderAccountId: principal.id,
      body,
      readByUser: true,
      readByCoach: false,
    })
    .returning({
      id: coachMessages.id,
      sender: coachMessages.sender,
      body: coachMessages.body,
      createdAt: coachMessages.createdAt,
    });

  const message = inserted[0];
  if (!message) return json({ error: 'invalid' }, 400);

  // Writing into a resolved ticket reopens it. Both staff inboxes default to
  // their Open tab, so without this a follow-up would be stored and notified
  // but invisible where staff actually work. Best-effort: the message is
  // already durable, and a failure here must not turn a delivered message into
  // a send error.
  const reopenedAt = new Date();
  try {
    await db
      .insert(supportThreadStates)
      .values({
        accountId: principal.id,
        status: 'open',
        resolvedBy: null,
        resolvedAt: null,
        updatedAt: reopenedAt,
      })
      .onConflictDoUpdate({
        target: supportThreadStates.accountId,
        set: { status: 'open', resolvedBy: null, resolvedAt: null, updatedAt: reopenedAt },
      });
  } catch (err) {
    console.error(`[partner support] reopen failed account=${principal.id}`, err);
  }

  const [partner] = await db
    .select({ name: mealPartners.name })
    .from(mealPartners)
    .where(eq(mealPartners.id, partnerId))
    .limit(1);
  const who = partner?.name?.trim() || 'A partner restaurant';
  const masked = maskPii(body);
  const snippet = masked.length > 120 ? `${masked.slice(0, 117)}...` : masked;

  after(() =>
    notify(
      'support_message_staff',
      { role: 'staff', permission: 'support.thread.read' },
      {
        title: 'New message from a restaurant',
        body: `${who}: ${snippet}`,
        data: { type: 'support', id: principal.id },
      },
    ),
  );

  return json(
    {
      message: {
        id: message.id,
        from: 'you' as const,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        unread: false,
      },
    },
    201,
  );
}
