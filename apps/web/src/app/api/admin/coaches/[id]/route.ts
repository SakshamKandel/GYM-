import { admins, coachProfiles } from '@gym/db';
import { and, eq } from 'drizzle-orm';
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

  // Confirm the target is actually a coach before touching profiles, so we
  // never mint a coach_profiles row for a non-coach account.
  const coach = await db
    .select({ accountId: admins.accountId })
    .from(admins)
    .where(and(eq(admins.accountId, id), eq(admins.role, 'coach')))
    .limit(1);
  if (coach.length === 0) return json({ error: 'not_found' }, 404);

  // Upsert (not a bare UPDATE): a legacy coach granted the role via
  // POST /api/admin/staff has no coach_profiles row yet, so a plain UPDATE would
  // match 0 rows → the admin's edit would silently vanish while the route
  // reported success/404 (C12).
  await db
    .insert(coachProfiles)
    .values({ accountId: id, ...update })
    .onConflictDoUpdate({ target: coachProfiles.accountId, set: update });

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(principal, 'coach.update', 'coach_profile', id, update, ip);

  return json({ ok: true }, 200);
}
