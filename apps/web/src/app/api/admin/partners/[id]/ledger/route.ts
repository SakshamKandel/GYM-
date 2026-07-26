import { mealPartners, partnerWalletLedger } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { loadPartnerHeld, loadPartnerLedger } from '@/app/partner/_data';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — one restaurant's wallet: its balance, its movements, and the
 * manual correction lever (the partner mirror of
 * POST /api/admin/wallets/[coachId]/entries).
 *
 *  - GET  → { partnerId, name, currency, earnedMinor, adjustmentMinor,
 *            paidOutMinor, heldMinor, entries } — the SAME held math the payout
 *            floor uses (loadPartnerHeld), so what an operator reads here and
 *            what a payout is allowed to draw can never disagree.
 *  - POST {type:'adjustment', amountMinor, currency, note?, idempotencyKey?}
 *            → 201 with the new row (200 on a deduped replay).
 *
 * Adjustments ONLY. `earning` rows are deliberately unwritable here: the earned
 * base is a DERIVED figure (the live delivered-digital-paid sum — see
 * loadPartnerHeld), so an `earning` row would double-count real revenue. And
 * `payout` rows belong to the payout rail alone, which posts them inside the
 * approval transaction keyed to the request. Correcting a balance therefore
 * always lands as an adjustment, either sign, never zero.
 *
 * The amount's currency must be the restaurant's own. Held is tracked per
 * partner AND currency, so an adjustment in any other currency would open a
 * bucket nothing else ever touches: it would never reach the balance the partner
 * can actually draw, and it could never be paid out.
 *
 * Guarded by requirePermission('wallet.manage') — the same key the coach rail
 * uses, and the one the permission copy already promises ("Open coach and
 * partner wallets, and record adjustments and payouts"). Audited 'wallet.adjust'.
 */

/**
 * Bound on a single correction: 1,000,000.00 either way. Nothing legitimate
 * comes near it, and it keeps a fat-fingered amount from overflowing the
 * integer column into a 500 instead of a clean rejection.
 */
const MAX_ADJUSTMENT_MINOR = 100_000_000;

const bodySchema = z.object({
  // Literal, not an enum: adjustments are the only entry this route may write.
  type: z.literal('adjustment'),
  amountMinor: z
    .number()
    .int()
    .min(-MAX_ADJUSTMENT_MINOR)
    .max(MAX_ADJUSTMENT_MINOR)
    .refine((v) => v !== 0, { message: 'adjustment must be non-zero' }),
  // Currency travels with the amount and is re-checked against the restaurant's
  // own currency below.
  currency: z.enum(['NPR', 'USD']),
  note: z.string().trim().max(500).optional(),
  // Optional idempotency key: a double-clicked or network-retried correction
  // carrying the same key records ONE row instead of moving the balance twice.
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

/** Manual admin rows are keyed per partner so two restaurants can never collide. */
function manualSourceId(partnerId: string, idempotencyKey: string): string {
  return `${partnerId}:${idempotencyKey}`;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'wallet.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const [partner] = await db
    .select({ id: mealPartners.id, name: mealPartners.name, currency: mealPartners.currency })
    .from(mealPartners)
    .where(eq(mealPartners.id, id))
    .limit(1);
  if (!partner) return json({ error: 'not_found' }, 404);

  const [held, entries] = await Promise.all([
    loadPartnerHeld(db, partner.id, partner.currency),
    loadPartnerLedger(db, partner.id),
  ]);

  return json(
    {
      partnerId: partner.id,
      name: partner.name,
      currency: partner.currency,
      earnedMinor: held.earnedMinor,
      adjustmentMinor: held.adjustmentMinor,
      paidOutMinor: held.paidOutMinor,
      heldMinor: held.heldMinor,
      entries,
    },
    200,
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'wallet.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { amountMinor, currency, note, idempotencyKey } = parsed.data;

  const db = getDb();

  const [partner] = await db
    .select({ id: mealPartners.id, currency: mealPartners.currency })
    .from(mealPartners)
    .where(eq(mealPartners.id, id))
    .limit(1);
  if (!partner) return json({ error: 'not_found' }, 404);

  if (partner.currency !== currency) {
    return json(
      { error: 'currency_mismatch', partnerCurrency: partner.currency, requestedCurrency: currency },
      409,
    );
  }

  const sourceType = idempotencyKey ? 'admin_manual' : null;
  const sourceId = idempotencyKey ? manualSourceId(partner.id, idempotencyKey) : null;

  const columns = {
    id: partnerWalletLedger.id,
    type: partnerWalletLedger.type,
    amountMinor: partnerWalletLedger.amountMinor,
    currency: partnerWalletLedger.currency,
    sourceType: partnerWalletLedger.sourceType,
    note: partnerWalletLedger.note,
    createdAt: partnerWalletLedger.createdAt,
  };

  // Idempotent when a key is supplied; with a NULL source the conflict target
  // never fires (Postgres treats NULLs as distinct), so an unkeyed correction
  // always inserts — matching the coach rail exactly.
  const inserted = await db
    .insert(partnerWalletLedger)
    .values({
      partnerId: partner.id,
      type: 'adjustment',
      amountMinor,
      currency,
      sourceType,
      sourceId,
      note: note ?? null,
      createdBy: principal.id,
    })
    .onConflictDoNothing({
      target: [partnerWalletLedger.sourceType, partnerWalletLedger.sourceId],
    })
    .returning(columns);

  let row = inserted[0];
  let duplicate = false;
  if (!row && sourceType != null && sourceId != null) {
    // A replay of the same key: hand back the row that already landed rather
    // than reporting a failure the operator would retry into a second entry.
    const [existing] = await db
      .select(columns)
      .from(partnerWalletLedger)
      .where(
        and(
          eq(partnerWalletLedger.sourceType, sourceType),
          eq(partnerWalletLedger.sourceId, sourceId),
        ),
      )
      .limit(1);
    row = existing;
    duplicate = existing != null;
  }
  if (!row) return json({ error: 'not_recorded' }, 500);

  const entry = { ...row, createdAt: row.createdAt.toISOString() };

  // A deduped replay changed nothing — don't write a second audit row for it.
  if (!duplicate) {
    await logAudit(
      principal,
      'wallet.adjust',
      'partner_wallet_ledger',
      row.id,
      { partnerId: partner.id, type: 'adjustment', amountMinor, currency },
      clientIp(req),
    );
  }

  return json({ entry }, duplicate ? 200 : 201);
}
