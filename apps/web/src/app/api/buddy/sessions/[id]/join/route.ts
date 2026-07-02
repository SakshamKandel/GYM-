import { accounts, buddyLinks, buddySessions, buddySessionParticipants } from '@gym/db';
import { and, eq, or } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

/** POST — join a buddy's live session. Requires accepted buddy + same tier. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { id } = await ctx.params;
  const db = getDb();

  const sessions = await db
    .select({
      id: buddySessions.id,
      hostId: buddySessions.hostId,
      status: buddySessions.status,
    })
    .from(buddySessions)
    .where(eq(buddySessions.id, id))
    .limit(1);

  const session = sessions[0];
  if (!session) return json({ error: 'not_found' }, 404);
  if (session.status !== 'active') return json({ error: 'invalid' }, 400);

  // Must be accepted buddies.
  const links = await db
    .select({ id: buddyLinks.id })
    .from(buddyLinks)
    .where(
      and(
        eq(buddyLinks.status, 'accepted'),
        or(
          and(eq(buddyLinks.requesterId, me.id), eq(buddyLinks.addresseeId, session.hostId)),
          and(eq(buddyLinks.requesterId, session.hostId), eq(buddyLinks.addresseeId, me.id)),
        ),
      ),
    )
    .limit(1);

  if (links.length === 0) return json({ error: 'forbidden' }, 403);

  // Same subscription tier required.
  const hosts = await db
    .select({ tier: accounts.tier })
    .from(accounts)
    .where(eq(accounts.id, session.hostId))
    .limit(1);

  if (hosts[0] && hosts[0].tier !== me.tier) {
    return json({ error: 'tier_mismatch' }, 403);
  }

  // Insert participant (ignore duplicate — unique index handles it).
  try {
    await db
      .insert(buddySessionParticipants)
      .values({ sessionId: session.id, accountId: me.id });
  } catch {
    // Already joined — that's fine.
  }

  return json({ ok: true }, 200);
}
