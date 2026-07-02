import { buddyLinks } from '@gym/db';
import { eq } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { id } = await ctx.params;

  const db = getDb();
  const links = await db
    .select({
      id: buddyLinks.id,
      requesterId: buddyLinks.requesterId,
      addresseeId: buddyLinks.addresseeId,
    })
    .from(buddyLinks)
    .where(eq(buddyLinks.id, id))
    .limit(1);

  const link = links[0];
  if (!link) return json({ error: 'not_found' }, 404);
  if (link.requesterId !== me.id && link.addresseeId !== me.id) {
    return json({ error: 'forbidden' }, 403);
  }

  // Only the link goes; buddyActivity history is intentionally kept.
  await db.delete(buddyLinks).where(eq(buddyLinks.id, link.id));
  return json({ ok: true }, 200);
}
