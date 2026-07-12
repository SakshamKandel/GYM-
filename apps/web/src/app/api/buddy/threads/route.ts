import { accounts, buddyLinks, buddyMessages } from '@gym/db';
import { and, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Friend-to-friend DMs (SCALE-UP-PLAN §4.4 / §6.4) — the buddy chat list.
 *
 *  - GET → one row per ACCEPTED buddy_links pair the caller belongs to
 *    (either direction), with the other member's identity (no email — this
 *    is a member-facing payload), the last message (null if the thread has
 *    no messages yet), and an unread count (messages from the OTHER member
 *    with readAt still null). Two extra round-trips beyond the link lookup:
 *    a DISTINCT ON for the latest message per link, and a grouped count for
 *    unread — both scoped to the caller's link ids, no N+1. Sorted
 *    most-recent-activity-first; threads with no messages yet sink last.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();

  // Accepted links either direction, carrying the OTHER account's identity.
  const outgoing = await db
    .select({ linkId: buddyLinks.id, buddyId: accounts.id, displayName: accounts.displayName })
    .from(buddyLinks)
    .innerJoin(accounts, eq(buddyLinks.addresseeId, accounts.id))
    .where(and(eq(buddyLinks.requesterId, me.id), eq(buddyLinks.status, 'accepted')));

  const incoming = await db
    .select({ linkId: buddyLinks.id, buddyId: accounts.id, displayName: accounts.displayName })
    .from(buddyLinks)
    .innerJoin(accounts, eq(buddyLinks.requesterId, accounts.id))
    .where(and(eq(buddyLinks.addresseeId, me.id), eq(buddyLinks.status, 'accepted')));

  const links = [...outgoing, ...incoming];
  if (links.length === 0) return json({ threads: [] }, 200);

  const linkIds = links.map((l) => l.linkId);

  const [lastMessages, unreadRows] = await Promise.all([
    db
      .selectDistinctOn([buddyMessages.linkId], {
        linkId: buddyMessages.linkId,
        body: buddyMessages.body,
        createdAt: buddyMessages.createdAt,
      })
      .from(buddyMessages)
      .where(inArray(buddyMessages.linkId, linkIds))
      .orderBy(buddyMessages.linkId, desc(buddyMessages.createdAt)),
    db
      .select({ linkId: buddyMessages.linkId, n: count() })
      .from(buddyMessages)
      .where(
        and(
          inArray(buddyMessages.linkId, linkIds),
          ne(buddyMessages.senderAccountId, me.id),
          isNull(buddyMessages.readAt),
        ),
      )
      .groupBy(buddyMessages.linkId),
  ]);

  const lastByLink = new Map(lastMessages.map((m) => [m.linkId, m]));
  const unreadByLink = new Map(unreadRows.map((r) => [r.linkId, r.n]));

  const threads = links
    .map((l) => {
      const last = lastByLink.get(l.linkId);
      return {
        linkId: l.linkId,
        buddy: { accountId: l.buddyId, displayName: l.displayName },
        lastBody: last?.body ?? null,
        lastAt: last?.createdAt ?? null,
        unread: unreadByLink.get(l.linkId) ?? 0,
      };
    })
    .sort((a, b) => {
      if (!a.lastAt && !b.lastAt) return 0;
      if (!a.lastAt) return 1;
      if (!b.lastAt) return -1;
      return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    });

  return json({ threads }, 200);
}
