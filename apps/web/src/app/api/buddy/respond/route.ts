import { buddyLinks } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { acceptedBuddyCount, authedUser, BUDDY_LIMIT } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  linkId: z.string().min(1),
  accept: z.boolean(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const links = await db
    .select({
      id: buddyLinks.id,
      requesterId: buddyLinks.requesterId,
      addresseeId: buddyLinks.addresseeId,
      status: buddyLinks.status,
    })
    .from(buddyLinks)
    .where(eq(buddyLinks.id, parsed.data.linkId))
    .limit(1);

  const link = links[0];
  if (!link) return json({ error: 'not_found' }, 404);
  if (link.addresseeId !== me.id) return json({ error: 'forbidden' }, 403);
  if (link.status !== 'pending') return json({ error: 'already_linked' }, 409);

  if (!parsed.data.accept) {
    await db.delete(buddyLinks).where(eq(buddyLinks.id, link.id));
    return json({ ok: true }, 200);
  }

  // Re-enforce the cap at accept time — either side may have filled up
  // since the invite was sent.
  const [mine, theirs] = await Promise.all([
    acceptedBuddyCount(db, me.id),
    acceptedBuddyCount(db, link.requesterId),
  ]);
  if (mine >= BUDDY_LIMIT || theirs >= BUDDY_LIMIT) {
    return json({ error: 'buddy_limit' }, 409);
  }

  await db.update(buddyLinks).set({ status: 'accepted' }).where(eq(buddyLinks.id, link.id));
  return json({ ok: true }, 200);
}
