import { accounts, promoCodes } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { expireGrantsForCode } from '@/lib/promoEconomy';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — edit one promo code (SCALE-UP-PLAN §4.1).
 *
 *  - PATCH {active?, maxRedemptions?, expiresAt?} → toggle active, raise/lower
 *    (or clear, via explicit null) the redemption cap, or the expiry window.
 *    `code`, `ownerCoachId`, `discountPct`, `commissionPct` are immutable here
 *    — recreate the code to change those. Audited with old→new values (E11) so
 *    an activate can be told apart from a deactivate. Deactivating a code also
 *    expires its outstanding discount grants (E5) and records a separate
 *    `promo.grant.expire` audit row.
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

  // Snapshot the pre-change values so the audit records old→new, not just field
  // names (E11) — activate vs deactivate is otherwise indistinguishable — and
  // so we can tell whether `active` actually transitioned true→false.
  const [before] = await db
    .select({
      active: promoCodes.active,
      maxRedemptions: promoCodes.maxRedemptions,
      expiresAt: promoCodes.expiresAt,
    })
    .from(promoCodes)
    .where(eq(promoCodes.id, id))
    .limit(1);
  if (!before) return json({ error: 'not_found' }, 404);

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

  // Value-level audit meta (E11): record each changed field's old→new value.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (update.active !== undefined && update.active !== before.active) {
    changes.active = { from: before.active, to: update.active };
  }
  if (update.maxRedemptions !== undefined && update.maxRedemptions !== before.maxRedemptions) {
    changes.maxRedemptions = { from: before.maxRedemptions, to: update.maxRedemptions };
  }
  if (update.expiresAt !== undefined) {
    const fromIso = before.expiresAt ? before.expiresAt.toISOString() : null;
    const toIso = update.expiresAt ? update.expiresAt.toISOString() : null;
    if (fromIso !== toIso) changes.expiresAt = { from: fromIso, to: toIso };
  }

  await logAudit(
    principal,
    'promo.update',
    'promo_code',
    row.id,
    { code: row.code, changes },
    clientIp(req),
  );

  // Deactivating a live code expires its outstanding grants (E5) so they stop
  // discounting purchases / paying commission; logged as its own action so the
  // downstream effect is visible in the audit trail.
  if (update.active === false && before.active === true) {
    const expired = await expireGrantsForCode(row.id);
    if (expired > 0) {
      await logAudit(
        principal,
        'promo.grant.expire',
        'promo_code',
        row.id,
        { code: row.code, grantsExpired: expired },
        clientIp(req),
      );
    }
  }

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
