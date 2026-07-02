import { accounts, buddyLinks } from '@gym/db';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { acceptedBuddyCount, authedUser, BUDDY_LIMIT } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string().email(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const email = parsed.data.email.toLowerCase();
  const db = getDb();

  const targets = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  const target = targets[0];
  if (!target) return json({ error: 'not_found' }, 404);
  if (target.id === me.id) return json({ error: 'invalid' }, 400);

  // Any link in either direction (pending or accepted) blocks a new invite.
  const existing = await db
    .select({ id: buddyLinks.id })
    .from(buddyLinks)
    .where(
      or(
        and(eq(buddyLinks.requesterId, me.id), eq(buddyLinks.addresseeId, target.id)),
        and(eq(buddyLinks.requesterId, target.id), eq(buddyLinks.addresseeId, me.id)),
      ),
    )
    .limit(1);
  if (existing.length > 0) return json({ error: 'already_linked' }, 409);

  const [mine, theirs] = await Promise.all([
    acceptedBuddyCount(db, me.id),
    acceptedBuddyCount(db, target.id),
  ]);
  if (mine >= BUDDY_LIMIT || theirs >= BUDDY_LIMIT) {
    return json({ error: 'buddy_limit' }, 409);
  }

  const created = await db
    .insert(buddyLinks)
    .values({ requesterId: me.id, addresseeId: target.id })
    .returning({
      id: buddyLinks.id,
      requesterId: buddyLinks.requesterId,
      addresseeId: buddyLinks.addresseeId,
      status: buddyLinks.status,
      createdAt: buddyLinks.createdAt,
    });

  const link = created[0];
  if (!link) return json({ error: 'invalid' }, 400);

  // Notify the addressee — fire-and-forget; never blocks or breaks the response.
  const requesterName = me.displayName || me.email;
  void sendPushToAccount(target.id, {
    title: 'New gym buddy request',
    body: `${requesterName} wants to train with you`,
    data: { type: 'buddy_invite', linkId: link.id },
  });

  return json({ link }, 201);
}
