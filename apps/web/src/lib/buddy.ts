import { buddyLinks, type Db } from '@gym/db';
import { and, count, eq, or } from 'drizzle-orm';
import { bearerToken, userForToken, type PublicUser } from './auth';

/** Hard cap on accepted buddies per account — keeps it intimate, not a feed. */
export const BUDDY_LIMIT = 5;

/** Resolves the Bearer session to a user, or null → caller returns 401. */
export async function authedUser(req: Request): Promise<PublicUser | null> {
  const token = bearerToken(req);
  if (!token) return null;
  return userForToken(token);
}

/** Number of ACCEPTED links this account participates in (either direction). */
export async function acceptedBuddyCount(db: Db, accountId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(buddyLinks)
    .where(
      and(
        eq(buddyLinks.status, 'accepted'),
        or(eq(buddyLinks.requesterId, accountId), eq(buddyLinks.addresseeId, accountId)),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** Account ids of all ACCEPTED buddies of this account. */
export async function acceptedBuddyIds(db: Db, accountId: string): Promise<string[]> {
  const rows = await db
    .select({ requesterId: buddyLinks.requesterId, addresseeId: buddyLinks.addresseeId })
    .from(buddyLinks)
    .where(
      and(
        eq(buddyLinks.status, 'accepted'),
        or(eq(buddyLinks.requesterId, accountId), eq(buddyLinks.addresseeId, accountId)),
      ),
    );
  return rows.map((r) => (r.requesterId === accountId ? r.addresseeId : r.requesterId));
}
