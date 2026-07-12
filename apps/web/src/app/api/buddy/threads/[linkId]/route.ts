import { buddyLinks, buddyMessages, type Db } from '@gym/db';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Friend-to-friend DMs — one buddy_links thread (SCALE-UP-PLAN §4.4 / §6.4).
 *
 *  - GET ?after=ISO → the newest 200 messages matching the (optional) cursor,
 *    returned oldest→newest — capped by recency, not by creation order, so a
 *    thread past the 200 cap never buries what's actually new. Then marks
 *    ONLY those returned rows readAt=now() on the OTHER member's side —
 *    clears my unread badge for what I actually saw, not the whole thread.
 *  - POST {body} → inserts a message from me. NO PII masking (mutually
 *    accepted contacts, per §6.4) — just trimmed + length-bounded by the zod
 *    schema below. Rate-limited 30/min. Pushes 'buddy_message' to the other
 *    member.
 *
 * Both handlers resolve link membership + accepted status in ONE query
 * (acceptedLinkMembership below): id match, status='accepted', and the
 * caller is either the requester or the addressee — 403 otherwise.
 */

const MESSAGE_LIMIT = 200;
const postSchema = z.object({ body: z.string().trim().min(1).max(2000) });

interface LinkMembership {
  id: string;
  requesterId: string;
  addresseeId: string;
}

async function acceptedLinkMembership(
  db: Db,
  linkId: string,
  accountId: string,
): Promise<LinkMembership | null> {
  const rows = await db
    .select({
      id: buddyLinks.id,
      requesterId: buddyLinks.requesterId,
      addresseeId: buddyLinks.addresseeId,
    })
    .from(buddyLinks)
    .where(
      and(
        eq(buddyLinks.id, linkId),
        eq(buddyLinks.status, 'accepted'),
        or(eq(buddyLinks.requesterId, accountId), eq(buddyLinks.addresseeId, accountId)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ linkId: string }> },
) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { linkId } = await params;
  const db = getDb();

  const link = await acceptedLinkMembership(db, linkId, me.id);
  if (!link) return json({ error: 'forbidden' }, 403);

  const afterParam = new URL(req.url).searchParams.get('after');
  const conditions = [eq(buddyMessages.linkId, linkId)];
  if (afterParam) {
    const afterDate = new Date(afterParam);
    if (!Number.isNaN(afterDate.getTime())) {
      conditions.push(gt(buddyMessages.createdAt, afterDate));
    }
  }

  // Newest MESSAGE_LIMIT first (so a thread past the cap never hides the
  // latest activity), then reversed back to oldest→newest for the client.
  // The mobile client never wires the `after` cursor — it always re-fetches
  // from scratch — so an ascending-then-capped query would permanently bury
  // any message past position 200 (including the sender's own just-sent
  // one). Ordering by recency first, THEN capping, keeps the visible window
  // anchored to "now" instead of thread creation.
  const rows = (
    await db
      .select({
        id: buddyMessages.id,
        senderAccountId: buddyMessages.senderAccountId,
        body: buddyMessages.body,
        createdAt: buddyMessages.createdAt,
      })
      .from(buddyMessages)
      .where(and(...conditions))
      .orderBy(desc(buddyMessages.createdAt))
      .limit(MESSAGE_LIMIT)
  ).reverse();

  // Mark read ONLY the other member's rows actually returned above — not the
  // whole thread. Marking rows the client never received (e.g. very old ones
  // pushed out of the 200-message window) would silently clear the unread
  // badge for messages that were never shown.
  const unreadIds = rows
    .filter((m) => m.senderAccountId !== me.id)
    .map((m) => m.id);
  if (unreadIds.length > 0) {
    await db
      .update(buddyMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(buddyMessages.linkId, linkId),
          inArray(buddyMessages.id, unreadIds),
          isNull(buddyMessages.readAt),
        ),
      );
  }

  return json({ messages: rows }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ linkId: string }> },
) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { linkId } = await params;
  const db = getDb();

  const link = await acceptedLinkMembership(db, linkId, me.id);
  if (!link) return json({ error: 'forbidden' }, 403);

  const limited = rateLimit({
    route: 'buddy/threads',
    limit: 30,
    windowMs: 60_000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  // No PII masking here — mutually-accepted contacts (SCALE-UP-PLAN §6.4).
  const body = parsed.data.body;

  const inserted = await db
    .insert(buddyMessages)
    .values({ linkId, senderAccountId: me.id, body })
    .returning({
      id: buddyMessages.id,
      senderAccountId: buddyMessages.senderAccountId,
      body: buddyMessages.body,
      createdAt: buddyMessages.createdAt,
    });

  const message = inserted[0];
  if (!message) return json({ error: 'invalid' }, 400);

  const otherId = link.requesterId === me.id ? link.addresseeId : link.requesterId;
  const senderName = me.displayName.trim() || 'Your buddy';

  after(() =>
    sendPushToAccount(otherId, {
      title: `${senderName} sent a message`,
      body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
      data: { type: 'buddy_message', linkId, messageId: message.id },
    }),
  );

  return json({ message }, 201);
}
