import { coachAssignments, coachProfiles, coachRequests } from '@gym/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — decide an inbound coaching request.
 *
 *  - POST {action:'accept'|'decline'} on a PENDING request addressed to ME
 *    (anything else 404s — no oracle for other coaches' queues).
 *
 *    accept  → capacity re-checked at decision time (the queue may have grown
 *              since the member applied), then the assignment is upserted
 *              active (the unique (coach,user) pair reactivates an ended row,
 *              mirroring /api/admin/assignments) and the member's OTHER active
 *              assignments are ended so "my coach" stays singular.
 *    decline → request marked declined; the push copy never says "declined" —
 *              the member just sees the coach has no room.
 */

/**
 * A pending request older than this can no longer be accepted/declined here.
 * Mirrors STALE_MS in GET /api/admin/oversight/coach-requests — that route's
 * sweep only runs when an admin loads the oversight page (no cron), so this
 * endpoint enforces its own age check rather than trusting the sweep to have
 * already run.
 */
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

const postSchema = z.object({ action: z.enum(['accept', 'decline']) });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({
      id: coachRequests.id,
      userId: coachRequests.userId,
      coachId: coachRequests.coachId,
      status: coachRequests.status,
      createdAt: coachRequests.createdAt,
    })
    .from(coachRequests)
    .where(eq(coachRequests.id, id))
    .limit(1);
  const request = rows[0];
  if (!request || request.coachId !== principal.id || request.status !== 'pending') {
    return json({ error: 'not_found' }, 404);
  }

  if (Date.now() - request.createdAt.getTime() > STALE_MS) {
    // Auto-expire inline (CAS — a concurrent decision elsewhere always wins).
    const updated = await db
      .update(coachRequests)
      .set({ status: 'canceled', decidedAt: new Date() })
      .where(and(eq(coachRequests.id, request.id), eq(coachRequests.status, 'pending')))
      .returning({ id: coachRequests.id });
    if (updated.length > 0) {
      await logAudit(principal, 'coach_request.auto_expire', 'coach_request', request.id, {
        userId: request.userId,
        pendingSince: request.createdAt.toISOString(),
      });
    }
    return json({ error: 'expired' }, 404);
  }

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { action } = parsed.data;

  const profiles = await db
    .select({ displayName: coachProfiles.displayName, capacity: coachProfiles.capacity })
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, principal.id))
    .limit(1);
  const coachName = profiles[0]?.displayName || 'Coach';

  if (action === 'accept') {
    // Re-check capacity at decision time; schema default when the profile row
    // hasn't been lazily created yet.
    const capacity = profiles[0]?.capacity ?? 50;
    const counts = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(coachAssignments)
      .where(
        and(eq(coachAssignments.coachId, principal.id), eq(coachAssignments.status, 'active')),
      );
    if ((counts[0]?.n ?? 0) >= capacity) return json({ error: 'full' }, 409);

    await db
      .insert(coachAssignments)
      .values({
        coachId: principal.id,
        userId: request.userId,
        status: 'active',
        assignedBy: principal.id,
      })
      .onConflictDoUpdate({
        target: [coachAssignments.coachId, coachAssignments.userId],
        set: { status: 'active', assignedBy: principal.id },
      });

    // "My coach" is singular — end any other coach's active claim.
    await db
      .update(coachAssignments)
      .set({ status: 'ended' })
      .where(
        and(
          eq(coachAssignments.userId, request.userId),
          ne(coachAssignments.coachId, principal.id),
          eq(coachAssignments.status, 'active'),
        ),
      );

    await db
      .update(coachRequests)
      .set({ status: 'accepted', decidedAt: new Date() })
      .where(eq(coachRequests.id, request.id));

    await logAudit(principal, 'coach.request.accept', 'coach_request', request.id, {
      userId: request.userId,
    });

    after(() =>
      sendPushToAccount(request.userId, {
        title: 'Coach request accepted',
        body: `${coachName} is now your coach.`,
        data: { type: 'coach_request_decided' },
      }),
    );

    return json({ ok: true }, 200);
  }

  await db
    .update(coachRequests)
    .set({ status: 'declined', decidedAt: new Date() })
    .where(eq(coachRequests.id, request.id));

  await logAudit(principal, 'coach.request.decline', 'coach_request', request.id, {
    userId: request.userId,
  });

  after(() =>
    sendPushToAccount(request.userId, {
      title: 'Coach request update',
      body: `${coachName} can't take new clients right now.`,
      data: { type: 'coach_request_decided' },
    }),
  );

  return json({ ok: true }, 200);
}
