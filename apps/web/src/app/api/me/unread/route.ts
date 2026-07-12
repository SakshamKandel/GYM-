import { buddyLinks, buddyMessages, coachMessages } from '@gym/db';
import { and, count, eq, isNull, ne, or } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Single cheap unread-badge endpoint (SCALE-UP-PLAN §4.4) — kept OFF `/api/me`
 * so that lean payload stays lean. Three grouped queries, run in parallel:
 *
 *  - support:   coach-sender coach_messages(kind='support') not readByUser.
 *  - coachChat: coach-sender coach_messages(kind='coach_chat') not readByUser.
 *  - buddy:     per ACCEPTED buddy_links, buddy_messages sent by the OTHER
 *               member with readAt still null, grouped by linkId. Only links
 *               with at least one unread row are included (sparse list).
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();

  const [supportRows, coachChatRows, buddyRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(coachMessages)
      .where(
        and(
          eq(coachMessages.accountId, me.id),
          eq(coachMessages.kind, 'support'),
          eq(coachMessages.sender, 'coach'),
          eq(coachMessages.readByUser, false),
        ),
      ),
    db
      .select({ n: count() })
      .from(coachMessages)
      .where(
        and(
          eq(coachMessages.accountId, me.id),
          eq(coachMessages.kind, 'coach_chat'),
          eq(coachMessages.sender, 'coach'),
          eq(coachMessages.readByUser, false),
        ),
      ),
    db
      .select({ linkId: buddyMessages.linkId, n: count() })
      .from(buddyMessages)
      .innerJoin(buddyLinks, eq(buddyMessages.linkId, buddyLinks.id))
      .where(
        and(
          eq(buddyLinks.status, 'accepted'),
          or(eq(buddyLinks.requesterId, me.id), eq(buddyLinks.addresseeId, me.id)),
          ne(buddyMessages.senderAccountId, me.id),
          isNull(buddyMessages.readAt),
        ),
      )
      .groupBy(buddyMessages.linkId),
  ]);

  return json(
    {
      support: supportRows[0]?.n ?? 0,
      coachChat: coachChatRows[0]?.n ?? 0,
      buddy: buddyRows.map((r) => ({ linkId: r.linkId, count: r.n })),
    },
    200,
  );
}
