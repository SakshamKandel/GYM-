import { coachRequests } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';

export const runtime = 'nodejs';

/**
 * Admin console — force-cancel one PENDING coach_requests row (ADMIN-MASTER-PLAN
 * §3 P1-8). Distinct from the sibling auto-expiry sweep: this is an explicit
 * admin decision (e.g. a member reports the request is wrong / duplicate),
 * available on any pending row regardless of age.
 *
 *  - POST {reason?} on a PENDING request → CAS to 'canceled'; anything else
 *    (unknown id, already-decided) 404s — no oracle.
 *
 * Guarded by requirePermission('moderation.manage').
 */

const postSchema = z.object({ reason: z.string().trim().max(300).optional() });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'moderation.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { reason } = parsed.data;

  const db = getDb();
  const updated = await db
    .update(coachRequests)
    .set({ status: 'canceled', decidedAt: new Date() })
    .where(and(eq(coachRequests.id, id), eq(coachRequests.status, 'pending')))
    .returning({ id: coachRequests.id, userId: coachRequests.userId, coachId: coachRequests.coachId });

  const row = updated[0];
  if (!row) return json({ error: 'not_found' }, 404);

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(
    principal,
    'coach_request.admin_cancel',
    'coach_request',
    id,
    { userId: row.userId, coachId: row.coachId, reason },
    ip,
  );

  // The member's request just disappeared from their app with no explanation.
  // Tell them, and point them back at the directory. The CAS above means at
  // most one caller ever flips this row, so this fires exactly once — no
  // dedupe key needed. `reason` is OPERATOR free text and is deliberately NOT
  // echoed: notification copy is server-templated (§7.2-S2), and the member
  // should never read an internal moderation note.
  after(() =>
    notify(
      'coach_request_closed',
      { accountId: row.userId },
      {
        title: 'Coach request closed',
        body: 'Your coach request was closed. You can ask another coach whenever you are ready.',
        data: { type: 'coach_request_decided' },
      },
    ),
  );

  return json({ ok: true }, 200);
}
