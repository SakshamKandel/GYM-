import { admins } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { coachWalletBalances, recordWalletEntry } from '@/lib/promoEconomy';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — record a manual wallet_ledger entry for one coach
 * (SCALE-UP-PLAN §4.1 / §5.4): an adjustment (correction, either sign, never
 * zero) or a payout (money actually paid out to the coach — represented as a
 * NEGATIVE amount, since the eSewa/Khalti disbursement itself happens outside
 * the app per §9's out-of-scope list; this just records that it happened).
 *
 *  - POST {type:'adjustment'|'payout', amountMinor, currency, note?} → 201.
 *    `commission` entries are never created here — those are exclusively
 *    settlePromoOnPurchase's job.
 *
 * Guarded by requirePermission('wallet.manage'); super_admin/main_admin pass.
 */

const bodySchema = z
  .object({
    type: z.enum(['adjustment', 'payout']),
    amountMinor: z.number().int(),
    // Currency is a fixed enum, not free text (E7): a typo like 'NPRR' would
    // otherwise mint a phantom balance bucket that fragments the coach's real
    // balance so a genuine payout can never reconcile.
    currency: z.enum(['NPR', 'USD']),
    note: z.string().trim().max(500).optional(),
    // Escape hatch to record a payout that exceeds the tracked balance (e.g.
    // reconciling a pre-app disbursement); off by default so the floor holds.
    override: z.boolean().optional(),
  })
  .refine((v) => (v.type === 'payout' ? v.amountMinor < 0 : v.amountMinor !== 0), {
    message: 'payout must be negative; adjustment must be non-zero',
    path: ['amountMinor'],
  });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ coachId: string }> }) {
  const principal = await requirePermission(req, 'wallet.manage');
  if (principal instanceof Response) return principal;

  const { coachId } = await params;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { type, amountMinor, currency, note, override } = parsed.data;

  const db = getDb();
  const [coach] = await db
    .select({ role: admins.role })
    .from(admins)
    .where(eq(admins.accountId, coachId))
    .limit(1);
  if (!coach || coach.role !== 'coach') return json({ error: 'coach_not_found' }, 404);

  // Payout balance floor (E7): a payout must not drive the coach's balance in
  // that currency negative — over-paid money is unrecoverable in-app. Callers
  // can pass override:true to record a reconciling payout beyond the balance.
  if (type === 'payout' && !override) {
    const balances = await coachWalletBalances(coachId);
    const current = balances.find((b) => b.currency === currency)?.amountMinor ?? 0;
    if (current + amountMinor < 0) {
      return json(
        { error: 'insufficient_balance', balanceMinor: current, currency },
        409,
      );
    }
  }

  const entry = await recordWalletEntry({
    coachId,
    type,
    amountMinor,
    currency,
    note: note ?? null,
    createdBy: principal.id,
  });

  await logAudit(
    principal,
    'wallet.adjust',
    'wallet_ledger',
    entry.id,
    { coachId, type, amountMinor, currency: entry.currency },
    clientIp(req),
  );

  return json({ entry }, 201);
}
