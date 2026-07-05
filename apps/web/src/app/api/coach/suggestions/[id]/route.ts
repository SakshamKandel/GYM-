import { progressionSuggestions } from '@gym/db';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — review a single progression suggestion.
 *
 *  - POST {action:'approve'} → status 'approved', coach identity + reviewedAt
 *    stamped, any previous adjustment cleared.
 *  - POST {action:'adjust', weightKg, note?} → status 'adjusted' with the
 *    coach's override weight (canonical kg) and optional note.
 *
 * Guards (both, fail closed): requirePermission('coach.message.user') +
 * requireCoachOwnsUser(principal, row.accountId) — the owning member comes
 * from the ROW, never from the request, so a coach can only ever review
 * suggestions belonging to their own assigned clients.
 */

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({
    action: z.literal('adjust'),
    weightKg: z.number().min(0).max(10_000),
    note: z.string().trim().max(500).optional(),
  }),
]);

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({ id: progressionSuggestions.id, accountId: progressionSuggestions.accountId })
    .from(progressionSuggestions)
    .where(eq(progressionSuggestions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  if (!(await requireCoachOwnsUser(principal, row.accountId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const body = parsed.data;

  const updated = await db
    .update(progressionSuggestions)
    .set(
      body.action === 'approve'
        ? {
            status: 'approved',
            coachId: principal.id,
            reviewedAt: new Date(),
            adjustedWeightKg: null,
            coachNote: null,
          }
        : {
            status: 'adjusted',
            coachId: principal.id,
            reviewedAt: new Date(),
            adjustedWeightKg: body.weightKg,
            coachNote: body.note?.length ? body.note : null,
          },
    )
    .where(eq(progressionSuggestions.id, id))
    .returning();

  const suggestion = updated[0];
  if (!suggestion) return json({ error: 'not_found' }, 404);

  // Best-effort notify; never blocks or fails the review (sendPushToAccount
  // never throws and no-ops without FIREBASE_SERVICE_ACCOUNT_B64). Wrapped in
  // after() so the serverless runtime keeps the FCM send alive past the
  // response instead of freezing it mid-flight.
  after(() => sendPushToAccount(row.accountId, {
    title: body.action === 'approve' ? 'Progression approved' : 'Progression adjusted',
    body:
      body.action === 'approve'
        ? 'Your coach approved your next progression.'
        : 'Your coach adjusted your next progression.',
    data: { type: 'suggestion_reviewed', suggestionId: id, action: body.action },
  }));

  await logAudit(principal, 'coach.suggestion.review', 'progression_suggestion', id, {
    action: body.action,
    userId: row.accountId,
    ...(body.action === 'adjust' ? { weightKg: body.weightKg } : {}),
  });

  return json({ suggestion }, 200);
}
