import { accounts, buddyLinks } from '@gym/db';
import { eq } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

interface BuddyEntry {
  linkId: string;
  buddy: { id: string; displayName: string; email: string };
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();

  // Links I sent — the buddy is the addressee.
  const outgoing = await db
    .select({
      linkId: buddyLinks.id,
      status: buddyLinks.status,
      buddyId: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
    })
    .from(buddyLinks)
    .innerJoin(accounts, eq(buddyLinks.addresseeId, accounts.id))
    .where(eq(buddyLinks.requesterId, me.id));

  // Links sent to me — the buddy is the requester.
  const incoming = await db
    .select({
      linkId: buddyLinks.id,
      status: buddyLinks.status,
      buddyId: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
    })
    .from(buddyLinks)
    .innerJoin(accounts, eq(buddyLinks.requesterId, accounts.id))
    .where(eq(buddyLinks.addresseeId, me.id));

  const toEntry = (r: (typeof outgoing)[number]): BuddyEntry => ({
    linkId: r.linkId,
    buddy: { id: r.buddyId, displayName: r.displayName, email: r.email },
  });

  const accepted: BuddyEntry[] = [
    ...outgoing.filter((r) => r.status === 'accepted').map(toEntry),
    ...incoming.filter((r) => r.status === 'accepted').map(toEntry),
  ];
  const pendingOut = outgoing.filter((r) => r.status === 'pending').map(toEntry);
  const pendingIn = incoming.filter((r) => r.status === 'pending').map(toEntry);

  return json({ accepted, pendingIn, pendingOut }, 200);
}
