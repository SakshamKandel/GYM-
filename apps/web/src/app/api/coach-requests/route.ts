import { admins, coachAssignments, coachProfiles, coachRequests } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { adminRoleOf } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Member-initiated coach requests (the matching flow).
 *
 *  - POST {coachId, message?} → one PENDING request at a time, only toward an
 *          active coach with open capacity. The intro message is PII-masked
 *          BEFORE storage (contact details never reach the database). The
 *          coach gets a push, best-effort via after().
 *  - GET  → the caller's own request history, newest first.
 */

const postSchema = z.object({
  coachId: z.string().min(1),
  message: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'coach-requests',
    limit: 5,
    windowMs: 60 * 60 * 1000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { coachId, message } = parsed.data;

  const db = getDb();

  // Target must be an ACTIVE coach — 404 keeps non-coach accounts unprobeable.
  const coaches = await db
    .select({
      accountId: admins.accountId,
      acceptingClients: coachProfiles.acceptingClients,
      capacity: coachProfiles.capacity,
    })
    .from(admins)
    .innerJoin(coachProfiles, eq(coachProfiles.accountId, admins.accountId))
    .where(
      and(
        eq(admins.accountId, coachId),
        eq(admins.role, 'coach'),
        eq(coachProfiles.isActive, true),
      ),
    )
    .limit(1);
  const coach = coaches[0];
  if (!coach) return json({ error: 'not_found' }, 404);

  // Staff accounts never enter the mentorship funnel as CLIENTS — the same
  // boundary /api/admin/assignments enforces on the target side.
  if ((await adminRoleOf(user.id)) !== null) return json({ error: 'forbidden' }, 403);

  const assigned = await db
    .select({ id: coachAssignments.id })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.coachId, coachId),
        eq(coachAssignments.userId, user.id),
        eq(coachAssignments.status, 'active'),
      ),
    )
    .limit(1);
  if (assigned.length > 0) return json({ error: 'already_assigned' }, 409);

  // One pending request per member, toward ANY coach — shop one at a time.
  const pending = await db
    .select({ id: coachRequests.id })
    .from(coachRequests)
    .where(and(eq(coachRequests.userId, user.id), eq(coachRequests.status, 'pending')))
    .limit(1);
  if (pending.length > 0) return json({ error: 'already_pending' }, 409);

  const activeCounts = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(coachAssignments)
    .where(and(eq(coachAssignments.coachId, coachId), eq(coachAssignments.status, 'active')));
  const activeClients = activeCounts[0]?.n ?? 0;
  if (!coach.acceptingClients || activeClients >= coach.capacity) {
    return json({ error: 'not_accepting' }, 409);
  }

  const inserted = await db
    .insert(coachRequests)
    .values({ userId: user.id, coachId, message: maskPii(message ?? '') })
    .returning({
      id: coachRequests.id,
      coachId: coachRequests.coachId,
      status: coachRequests.status,
      createdAt: coachRequests.createdAt,
    });

  const request = inserted[0];
  if (!request) return json({ error: 'invalid' }, 400);

  after(() =>
    sendPushToAccount(coachId, {
      title: 'New coaching request',
      body: 'A member asked you to be their coach.',
      data: { type: 'coach_request' },
    }),
  );

  return json({ request }, 201);
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = getDb();

  const rows = await db
    .select({
      id: coachRequests.id,
      coachId: coachRequests.coachId,
      coachName: coachProfiles.displayName,
      status: coachRequests.status,
      message: coachRequests.message,
      createdAt: coachRequests.createdAt,
      decidedAt: coachRequests.decidedAt,
    })
    .from(coachRequests)
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachRequests.coachId))
    .where(eq(coachRequests.userId, user.id))
    .orderBy(desc(coachRequests.createdAt))
    .limit(20);

  const requests = rows.map((r) => ({ ...r, coachName: r.coachName || 'Coach' }));

  return json({ requests }, 200);
}
