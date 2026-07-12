import { promoCodes, walletLedger } from '@gym/db';
import { and, desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { coachWalletBalances } from '@/lib/promoEconomy';

export const runtime = 'nodejs';

/**
 * A coach's own wallet (SCALE-UP-PLAN §4.1 / §5.2). Self-scoped: the caller's
 * own accountId is always the coachId — there is no cross-coach targeting, so
 * `coach.wallet.read` (every coach role holds it) is the only guard needed.
 *
 *  - balances: SUM(wallet_ledger.amountMinor) grouped by currency.
 *  - code: this coach's newest ACTIVE owned promo code (their auto-generated
 *    30/30 code, or null if none is active) — {code, discountPct,
 *    commissionPct, redemptionCount}.
 *  - entries: 50 newest wallet_ledger rows, newest first.
 */

const ENTRY_LIMIT = 50;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.wallet.read');
  if (principal instanceof Response) return principal;

  const db = getDb();

  const [balances, codeRows, entries] = await Promise.all([
    coachWalletBalances(principal.id),
    db
      .select({
        code: promoCodes.code,
        discountPct: promoCodes.discountPct,
        commissionPct: promoCodes.commissionPct,
        redemptionCount: promoCodes.redemptionCount,
      })
      .from(promoCodes)
      .where(and(eq(promoCodes.ownerCoachId, principal.id), eq(promoCodes.active, true)))
      .orderBy(desc(promoCodes.createdAt))
      .limit(1),
    db
      .select({
        id: walletLedger.id,
        type: walletLedger.type,
        amountMinor: walletLedger.amountMinor,
        currency: walletLedger.currency,
        note: walletLedger.note,
        createdAt: walletLedger.createdAt,
      })
      .from(walletLedger)
      .where(eq(walletLedger.coachId, principal.id))
      .orderBy(desc(walletLedger.createdAt))
      .limit(ENTRY_LIMIT),
  ]);

  return json({ balances, code: codeRows[0] ?? null, entries }, 200);
}
