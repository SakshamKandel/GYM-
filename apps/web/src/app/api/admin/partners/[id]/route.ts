import { mealPartners, sessions } from '@gym/db';
import { latSchema, lngSchema } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin — edit or deactivate one meal partner (plan §2/§7 P6). Guarded by
 * `partners.manage` (super_admin/main_admin bypass only).
 *
 * A single PATCH covers both ordinary field edits and deactivation: setting
 * `isActive:false` on a currently-active row is a "deactivate" — per plan §7
 * this ALSO deletes every session for the partner's login account, a second
 * kill-switch alongside the isActive flag `requirePartner` checks on every
 * request (so a live token can't outrace the flip). Reactivating
 * (`isActive:true`) is a plain flag flip — no session action.
 */

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    contact: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    addressText: z.string().trim().max(500).optional(),
    serviceAreas: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    // Service-area geometry — center point + delivery reach (km). Nullable so an
    // admin can clear a previously-drawn area; the column names match 1:1 so the
    // `rest` spread flows straight into the update set.
    serviceLat: latSchema.nullable().optional(),
    serviceLng: lngSchema.nullable().optional(),
    serviceRadiusKm: z.number().finite().min(0).max(200).nullable().optional(),
    acceptsCod: z.boolean().optional(),
    currency: z.enum(['NPR', 'USD']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { isActive, ...rest } = parsed.data;

  const db = getDb();

  const [existing] = await db
    .select({ id: mealPartners.id, accountId: mealPartners.accountId, isActive: mealPartners.isActive })
    .from(mealPartners)
    .where(eq(mealPartners.id, id))
    .limit(1);
  if (!existing) return json({ error: 'not_found' }, 404);

  const deactivating = isActive === false && existing.isActive;

  const updated = await db
    .update(mealPartners)
    .set({
      ...rest,
      ...(isActive !== undefined ? { isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(mealPartners.id, id))
    .returning();
  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  if (deactivating) {
    // Second kill-switch: any live console/mobile token for this login dies
    // immediately, rather than lingering until requirePartner next re-checks.
    await db.delete(sessions).where(eq(sessions.accountId, existing.accountId));
  }

  await logAudit(
    principal,
    deactivating ? 'partner.deactivate' : 'partner.update',
    'meal_partners',
    id,
    { fields: Object.keys(parsed.data) },
    clientIp(req),
  );

  return json({ partner: updated[0] }, 200);
}
