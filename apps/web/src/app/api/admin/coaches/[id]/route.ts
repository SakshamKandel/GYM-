import { coachProfiles } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — direct overrides on a coach's profile (SCALE-UP-PLAN §4.2),
 * filling the "no admin edit" gap `/api/admin/coaches` (GET-only) left open.
 *
 *  - PATCH {isActive?, coachTier?, capacity?} → updates only the fields
 *    present, on the coach identified by `id` (an accountId). 404 when that
 *    account has no coach_profiles row.
 *
 * Guarded by requirePermission('coach.application.review'); audited.
 */

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  coachTier: z.enum(['silver', 'gold', 'elite']).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'coach.application.review');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const update = parsed.data;

  if (Object.keys(update).length === 0) {
    return json({ error: 'no_editable_fields' }, 400);
  }

  const db = getDb();
  const updated = await db
    .update(coachProfiles)
    .set(update)
    .where(eq(coachProfiles.accountId, id))
    .returning({ accountId: coachProfiles.accountId });

  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(principal, 'coach.update', 'coach_profile', id, update, ip);

  return json({ ok: true }, 200);
}
