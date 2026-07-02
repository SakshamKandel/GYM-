import { buddySessions } from '@gym/db';
import { eq } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

/** DELETE — end a live session (host only). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { id } = await ctx.params;
  const db = getDb();

  const sessions = await db
    .select({ id: buddySessions.id, hostId: buddySessions.hostId, status: buddySessions.status })
    .from(buddySessions)
    .where(eq(buddySessions.id, id))
    .limit(1);

  const session = sessions[0];
  if (!session) return json({ error: 'not_found' }, 404);
  if (session.hostId !== me.id) return json({ error: 'forbidden' }, 403);
  if (session.status !== 'active') return json({ error: 'invalid' }, 400);

  await db
    .update(buddySessions)
    .set({ status: 'ended', endedAt: new Date() })
    .where(eq(buddySessions.id, session.id));

  return json({ ok: true }, 200);
}
