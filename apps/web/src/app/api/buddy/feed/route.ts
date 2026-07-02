import { accounts, buddyActivity } from '@gym/db';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { acceptedBuddyIds, authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

const FEED_LIMIT = 30;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const buddyIds = await acceptedBuddyIds(db, me.id);
  if (buddyIds.length === 0) return json({ events: [] }, 200);

  const rows = await db
    .select({
      id: buddyActivity.id,
      actorId: accounts.id,
      actorName: accounts.displayName,
      type: buddyActivity.type,
      payload: buddyActivity.payload,
      createdAt: buddyActivity.createdAt,
    })
    .from(buddyActivity)
    .innerJoin(accounts, eq(buddyActivity.accountId, accounts.id))
    .where(
      and(
        inArray(buddyActivity.accountId, buddyIds),
        or(isNull(buddyActivity.targetId), eq(buddyActivity.targetId, me.id)),
      ),
    )
    .orderBy(desc(buddyActivity.createdAt))
    .limit(FEED_LIMIT);

  const events = rows.map((r) => ({
    id: r.id,
    actor: { id: r.actorId, displayName: r.actorName },
    type: r.type,
    payload: r.payload,
    createdAt: r.createdAt,
  }));

  return json({ events }, 200);
}
