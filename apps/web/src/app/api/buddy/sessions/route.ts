import { accounts, buddyActivity, buddySessions, buddySessionParticipants } from '@gym/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { acceptedBuddyIds, authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  workoutName: z.string().min(1).max(120),
});

export function OPTIONS() {
  return preflight();
}

/** GET — active live sessions from accepted buddies. */
export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const buddyIds = await acceptedBuddyIds(db, me.id);
  if (buddyIds.length === 0) return json({ sessions: [] }, 200);

  const rows = await db
    .select({
      id: buddySessions.id,
      hostId: accounts.id,
      hostName: accounts.displayName,
      hostTier: accounts.tier,
      workoutName: buddySessions.workoutName,
      status: buddySessions.status,
      startedAt: buddySessions.startedAt,
    })
    .from(buddySessions)
    .innerJoin(accounts, eq(buddySessions.hostId, accounts.id))
    .where(
      and(
        inArray(buddySessions.hostId, buddyIds),
        eq(buddySessions.status, 'active'),
      ),
    )
    .orderBy(desc(buddySessions.startedAt));

  const sessions = rows.map((r) => ({
    id: r.id,
    host: { id: r.hostId, displayName: r.hostName, tier: r.hostTier },
    workoutName: r.workoutName,
    status: r.status,
    startedAt: r.startedAt,
  }));

  return json({ sessions }, 200);
}

/** POST — start a new live workout session. */
export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();

  // End any existing active session for this user first.
  await db
    .update(buddySessions)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(buddySessions.hostId, me.id), eq(buddySessions.status, 'active')));

  const created = await db
    .insert(buddySessions)
    .values({ hostId: me.id, workoutName: parsed.data.workoutName })
    .returning({
      id: buddySessions.id,
      workoutName: buddySessions.workoutName,
      startedAt: buddySessions.startedAt,
    });

  const session = created[0];
  if (!session) return json({ error: 'invalid' }, 400);

  // Auto-join the host as a participant.
  await db
    .insert(buddySessionParticipants)
    .values({ sessionId: session.id, accountId: me.id });

  // Broadcast a live_session activity to buddies.
  const buddyIds = await acceptedBuddyIds(db, me.id);
  if (buddyIds.length > 0) {
    await db.insert(buddyActivity).values({
      accountId: me.id,
      type: 'live_session',
      targetId: null,
      payload: { sessionName: parsed.data.workoutName },
    });
  }

  return json({ session }, 201);
}
