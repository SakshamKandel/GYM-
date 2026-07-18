import { accounts, coachRequests } from '@gym/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — oversight of member-initiated coach_requests (ADMIN-MASTER-PLAN
 * §3 P1-8). There is no queue-owning role for this table today (coaches only see
 * their OWN inbound requests via GET /api/coach/requests); this route gives
 * moderation.manage holders visibility across every coach's queue plus a way to
 * cancel a stuck one.
 *
 *  - GET ?status=pending|accepted|declined|canceled (default pending) → rows
 *    joined to both the requesting member's and the target coach's identity,
 *    newest first, each carrying `ageDays`.
 *
 *    Stale auto-expiry is ENFORCED ON READ: there is no cron, so every GET
 *    first sweeps any status='pending' row older than STALE_MS, flips it to
 *    'canceled' (CAS per row — a concurrent accept/decline always wins), and
 *    audits each flip as 'coach_request.auto_expire'. The sweep runs before the
 *    status filter is applied so a stale row never shows up as "pending" in the
 *    same response that's supposed to be surfacing it.
 *
 * Guarded by requirePermission('moderation.manage').
 */

const STATUSES = ['pending', 'accepted', 'declined', 'canceled'] as const;
type Status = (typeof STATUSES)[number];

/** A pending request older than this is auto-expired on read (no cron exists). */
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

export function OPTIONS() {
  return preflight();
}

/**
 * Flips every stale-pending row to 'canceled', one CAS update per row so a
 * concurrent member-cancel or coach accept/decline always wins over the sweep.
 * Best-effort audit per flip; a lookup/update failure here must never block the
 * GET that triggered it (the sweep just runs again on the next read).
 */
async function sweepStaleRequests(
  principal: { id: string },
  ip: string | null,
): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - STALE_MS);

  let stale: Array<{ id: string; userId: string; coachId: string; createdAt: Date }>;
  try {
    stale = await db
      .select({
        id: coachRequests.id,
        userId: coachRequests.userId,
        coachId: coachRequests.coachId,
        createdAt: coachRequests.createdAt,
      })
      .from(coachRequests)
      .where(and(eq(coachRequests.status, 'pending'), lt(coachRequests.createdAt, cutoff)));
  } catch (err) {
    console.error('coach-requests stale sweep lookup failed:', err);
    return;
  }

  for (const row of stale) {
    try {
      const updated = await db
        .update(coachRequests)
        .set({ status: 'canceled', decidedAt: new Date() })
        .where(and(eq(coachRequests.id, row.id), eq(coachRequests.status, 'pending')))
        .returning({ id: coachRequests.id });
      if (updated.length === 0) continue; // someone else decided it first — not stale anymore

      await logAudit(
        principal,
        'coach_request.auto_expire',
        'coach_request',
        row.id,
        { userId: row.userId, coachId: row.coachId, pendingSince: row.createdAt.toISOString() },
        ip,
      );
    } catch (err) {
      console.error(`coach-requests stale sweep failed for ${row.id}:`, err);
    }
  }
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'moderation.manage');
  if (principal instanceof Response) return principal;

  const ip = req.headers.get('x-forwarded-for');
  await sweepStaleRequests(principal, ip);

  const raw = new URL(req.url).searchParams.get('status') ?? 'pending';
  if (!(STATUSES as readonly string[]).includes(raw)) return json({ error: 'invalid' }, 400);
  const status = raw as Status;

  const db = getDb();
  const member = alias(accounts, 'member');
  const coach = alias(accounts, 'coach');

  const rows = await db
    .select({
      id: coachRequests.id,
      status: coachRequests.status,
      message: coachRequests.message,
      createdAt: coachRequests.createdAt,
      decidedAt: coachRequests.decidedAt,
      member: { id: member.id, email: member.email, displayName: member.displayName },
      coach: { id: coach.id, email: coach.email, displayName: coach.displayName },
    })
    .from(coachRequests)
    .innerJoin(member, eq(member.id, coachRequests.userId))
    .innerJoin(coach, eq(coach.id, coachRequests.coachId))
    .where(eq(coachRequests.status, status))
    .orderBy(desc(coachRequests.createdAt))
    .limit(200);

  const now = Date.now();
  const requests = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    ageDays: Math.floor((now - r.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
  }));

  return json({ requests }, 200);
}
