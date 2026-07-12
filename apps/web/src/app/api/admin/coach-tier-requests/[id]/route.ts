import { coachProfiles, coachTierRequests } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Admin console — decide a coach tier-upgrade request (SCALE-UP-PLAN §4.2).
 *
 *  - POST {action:'approve'|'reject', note?} on a PENDING request. Anything
 *    else (unknown id, already-decided) 404s.
 *
 *    approve → writes coach_profiles.coachTier to the requested tier (guarded
 *      by a WHERE status='pending' write on the request row so two concurrent
 *      decisions can't both "win"), audits 'coach.tier.change', pushes
 *      `tier_request_decided`.
 *    reject → status + audit + push, no coachTier write.
 *
 * Guarded by requirePermission('coach.application.review').
 */

const postSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'coach.application.review');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { action, note } = parsed.data;

  const db = getDb();

  const rows = await db
    .select({
      id: coachTierRequests.id,
      coachId: coachTierRequests.coachId,
      requestedTier: coachTierRequests.requestedTier,
      status: coachTierRequests.status,
    })
    .from(coachTierRequests)
    .where(eq(coachTierRequests.id, id))
    .limit(1);
  const request = rows[0];
  if (!request || request.status !== 'pending') {
    return json({ error: 'not_found' }, 404);
  }

  const ip = req.headers.get('x-forwarded-for');

  if (action === 'reject') {
    await db
      .update(coachTierRequests)
      .set({ status: 'rejected', decidedBy: principal.id, decidedAt: new Date() })
      .where(and(eq(coachTierRequests.id, id), eq(coachTierRequests.status, 'pending')));

    await logAudit(
      principal,
      'coach.tier.reject',
      'coach_tier_request',
      id,
      { coachId: request.coachId, requestedTier: request.requestedTier, note },
      ip,
    );

    after(() =>
      sendPushToAccount(request.coachId, {
        title: 'Tier request update',
        body: 'Your coach tier upgrade request was not approved this time.',
        data: { type: 'tier_request_decided' },
      }),
    );

    return json({ ok: true }, 200);
  }

  // action === 'approve' — flip the request first (the WHERE guard is the
  // actual commit point / race guard), then write the tier.
  const updated = await db
    .update(coachTierRequests)
    .set({ status: 'approved', decidedBy: principal.id, decidedAt: new Date() })
    .where(and(eq(coachTierRequests.id, id), eq(coachTierRequests.status, 'pending')))
    .returning({ id: coachTierRequests.id });
  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  await db
    .update(coachProfiles)
    .set({ coachTier: request.requestedTier })
    .where(eq(coachProfiles.accountId, request.coachId));

  await logAudit(
    principal,
    'coach.tier.change',
    'coach_profile',
    request.coachId,
    { requestId: id, newTier: request.requestedTier, note },
    ip,
  );

  after(() =>
    sendPushToAccount(request.coachId, {
      title: 'Coach tier upgraded',
      body: `You've been upgraded to ${request.requestedTier} tier.`,
      data: { type: 'tier_request_decided' },
    }),
  );

  return json({ ok: true }, 200);
}
