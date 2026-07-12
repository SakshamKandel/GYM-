import { accounts, promoCodes } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — edit one promo code (SCALE-UP-PLAN §4.1).
 *
 *  - PATCH {active?, maxRedemptions?, expiresAt?} → toggle active, raise/lower
 *    (or clear, via explicit null) the redemption cap, or the expiry window.
 *    `code`, `ownerCoachId`, `discountPct`, `commissionPct` are immutable here
 *    — recreate the code to change those. Audited.
 *
 * Guarded by requirePermission('promo.manage'); super_admin/main_admin pass.
 */

// `undefined` (absent) leaves the column untouched; explicit `null` clears it
// (no cap / no expiry); a value sets it. Mirrors admin/subscriptions' dateField.
const dateField = z.coerce.date().nullable().optional();

const patchSchema = z
  .object({
    active: z.boolean().optional(),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    expiresAt: dateField,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'promo.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const fields = parsed.data;

  const update: { active?: boolean; maxRedemptions?: number | null; expiresAt?: Date | null } = {};
  if (fields.active !== undefined) update.active = fields.active;
  if (fields.maxRedemptions !== undefined) update.maxRedemptions = fields.maxRedemptions;
  if (fields.expiresAt !== undefined) update.expiresAt = fields.expiresAt;

  const db = getDb();
  const updated = await db
    .update(promoCodes)
    .set(update)
    .where(eq(promoCodes.id, id))
    .returning({
      id: promoCodes.id,
      code: promoCodes.code,
      ownerCoachId: promoCodes.ownerCoachId,
      discountPct: promoCodes.discountPct,
      commissionPct: promoCodes.commissionPct,
      active: promoCodes.active,
      redemptionCount: promoCodes.redemptionCount,
      maxRedemptions: promoCodes.maxRedemptions,
      expiresAt: promoCodes.expiresAt,
      createdAt: promoCodes.createdAt,
    });

  const row = updated[0];
  if (!row) return json({ error: 'not_found' }, 404);

  let ownerDisplayName: string | null = null;
  if (row.ownerCoachId) {
    const [owner] = await db
      .select({ displayName: accounts.displayName })
      .from(accounts)
      .where(eq(accounts.id, row.ownerCoachId))
      .limit(1);
    ownerDisplayName = owner?.displayName ?? null;
  }

  await logAudit(
    principal,
    'promo.update',
    'promo_code',
    row.id,
    { fields: Object.keys(update) },
    clientIp(req),
  );

  return json(
    {
      code: {
        id: row.id,
        code: row.code,
        ownerCoach: row.ownerCoachId ? { id: row.ownerCoachId, displayName: ownerDisplayName } : null,
        discountPct: row.discountPct,
        commissionPct: row.commissionPct,
        active: row.active,
        redemptionCount: row.redemptionCount,
        maxRedemptions: row.maxRedemptions,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      },
    },
    200,
  );
}
