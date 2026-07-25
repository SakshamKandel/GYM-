import { coachMessages } from '@gym/db';
import { and, count, eq } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Single cheap unread-badge endpoint (SCALE-UP-PLAN §4.4) — kept OFF `/api/me`
 * so that lean payload stays lean. Two grouped queries, run in parallel:
 *
 *  - support:   coach-sender coach_messages(kind='support') not readByUser.
 *  - coachChat: coach-sender coach_messages(kind='coach_chat') not readByUser.
 *
 * `buddy` is a retired key, now always an empty list. The Buddy feature was
 * deleted end-to-end so there is nothing left to count, but the key keeps both
 * its place AND its type: it has always been a sparse list of
 * `{ linkId, count }` rows, and a live response is no place to change what a
 * field is. Checked before writing this: every mobile build ever released reads
 * this endpoint through `z.object({ support: z.number() })`
 * (features/support/api.ts), which ignores `buddy` entirely — so the empty list
 * costs nothing and is what anything older would expect to find.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();

  const [supportRows, coachChatRows] = await Promise.all([
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
  ]);

  return json(
    {
      support: supportRows[0]?.n ?? 0,
      coachChat: coachChatRows[0]?.n ?? 0,
      buddy: [] as { linkId: string; count: number }[],
    },
    200,
  );
}
