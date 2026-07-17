import { accounts, admins, promoCodes } from '@gym/db';
import { generatePromoCode, normalizePromoCode } from '@gym/shared';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — promo code management (SCALE-UP-PLAN §1.3 / §4.1). Covers
 * both admin-created house codes (no owner, arbitrary discount 5–90%) and
 * admin-created/edited coach codes (ownerCoachId set). The auto-generated
 * one-per-verified-coach code is minted by the coach-application approval
 * flow (a different track's route) — this route is the general CRUD surface.
 *
 *  - GET → every code, newest first, with owner {id, displayName} or null.
 *  - POST {code?, ownerCoachId?, discountPct(5-90), commissionPct?(0-50),
 *    maxRedemptions?, expiresAt?} → when `code` is supplied it must pass
 *    normalizePromoCode and be free (409 `code_taken` on conflict); when
 *    omitted, one is generated (collision-retried) from the owner's display
 *    name or a generic 'HOUSE' seed. `ownerCoachId`, if set, must reference an
 *    `admins.role='coach'` account (400 `owner_not_coach` otherwise).
 *
 * Guarded by requirePermission('promo.manage'); super_admin/main_admin pass.
 */

const MAX_GENERATE_ATTEMPTS = 8;

const postSchema = z.object({
  code: z.string().trim().min(1).max(32).optional(),
  ownerCoachId: z.string().trim().min(1).optional(),
  discountPct: z.number().int().min(5).max(90),
  commissionPct: z.number().int().min(0).max(50).optional(),
  maxRedemptions: z.number().int().positive().optional(),
  // Reject an already-past expiry (E11): a born-dead code is never redeemable
  // and only clutters the table. A small skew allowance covers clock drift.
  expiresAt: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now() - 60_000, { message: 'expiry must be in the future' })
    .optional(),
});

const CODE_COLUMNS = {
  id: promoCodes.id,
  code: promoCodes.code,
  ownerCoachId: promoCodes.ownerCoachId,
  discountPct: promoCodes.discountPct,
  commissionPct: promoCodes.commissionPct,
  active: promoCodes.active,
  maxRedemptions: promoCodes.maxRedemptions,
  redemptionCount: promoCodes.redemptionCount,
  expiresAt: promoCodes.expiresAt,
  createdAt: promoCodes.createdAt,
} as const;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'promo.manage');
  if (principal instanceof Response) return principal;

  const rows = await getDb()
    .select({ ...CODE_COLUMNS, ownerDisplayName: accounts.displayName })
    .from(promoCodes)
    .leftJoin(accounts, eq(accounts.id, promoCodes.ownerCoachId))
    .orderBy(desc(promoCodes.createdAt));

  const codes = rows.map((r) => ({
    id: r.id,
    code: r.code,
    ownerCoach: r.ownerCoachId ? { id: r.ownerCoachId, displayName: r.ownerDisplayName } : null,
    discountPct: r.discountPct,
    commissionPct: r.commissionPct,
    active: r.active,
    redemptionCount: r.redemptionCount,
    maxRedemptions: r.maxRedemptions,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));

  return json({ codes }, 200);
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'promo.manage');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { ownerCoachId, discountPct, commissionPct, maxRedemptions, expiresAt } = parsed.data;

  const db = getDb();

  let ownerDisplayName: string | null = null;
  if (ownerCoachId) {
    const rows = await db
      .select({ role: admins.role, displayName: accounts.displayName })
      .from(admins)
      .innerJoin(accounts, eq(accounts.id, admins.accountId))
      .where(eq(admins.accountId, ownerCoachId))
      .limit(1);
    const owner = rows[0];
    if (!owner || owner.role !== 'coach') return json({ error: 'owner_not_coach' }, 400);
    ownerDisplayName = owner.displayName;
  }

  // A house code (no owner) has no coach to pay, so its commission is forced to
  // 0 regardless of what the client sent (E11) — otherwise settlement would
  // compute a commission with nowhere to credit it.
  const effectiveCommissionPct = ownerCoachId ? (commissionPct ?? 0) : 0;

  const values = {
    ownerCoachId: ownerCoachId ?? null,
    discountPct,
    commissionPct: effectiveCommissionPct,
    maxRedemptions: maxRedemptions ?? null,
    expiresAt: expiresAt ?? null,
    createdBy: principal.id,
  };

  let created: { id: string; code: string } | undefined;

  if (parsed.data.code !== undefined) {
    const normalized = normalizePromoCode(parsed.data.code);
    if (!normalized) return json({ error: 'invalid_code' }, 400);

    const inserted = await db
      .insert(promoCodes)
      .values({ code: normalized, ...values })
      .onConflictDoNothing({ target: promoCodes.code })
      .returning({ id: promoCodes.id, code: promoCodes.code });
    if (inserted.length === 0) return json({ error: 'code_taken' }, 409);
    created = inserted[0];
  } else {
    const seed = ownerDisplayName ?? 'HOUSE';
    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS && !created; attempt++) {
      const candidate = generatePromoCode(seed);
      const inserted = await db
        .insert(promoCodes)
        .values({ code: candidate, ...values })
        .onConflictDoNothing({ target: promoCodes.code })
        .returning({ id: promoCodes.id, code: promoCodes.code });
      created = inserted[0];
    }
    if (!created) return json({ error: 'code_generation_failed' }, 500);
  }

  await logAudit(
    principal,
    'promo.create',
    'promo_code',
    created.id,
    { code: created.code, ownerCoachId, discountPct, commissionPct: values.commissionPct },
    clientIp(req),
  );

  return json({ id: created.id, code: created.code }, 201);
}
