import { coachPayoutRequests } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { coachWalletBalances } from '@/lib/promoEconomy';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Coach-initiated payout requests (plan §3 P1-12). A coach asks to withdraw part
 * of their wallet balance in a single currency; an admin later approves it,
 * which posts the negative `wallet_ledger` payout entry (see
 * `/api/admin/payouts/[id]`). This route is SELF-SCOPED — the coachId is always
 * the caller's own account id, so `coach.wallet.read` (held by every coach, and
 * bypassed by super/main) is the only guard needed; there is no cross-coach
 * targeting.
 *
 *  - POST {amountMinor, currency} → 201 {id}. Enforces: a per-currency minimum
 *    threshold, and a balance FLOOR (cannot request more than the current
 *    ledger balance in that currency — the balance is recomputed here, never
 *    trusted from the client). At most one PENDING request per coach, enforced
 *    by the `coach_payout_requests_one_pending` partial unique index (a lost
 *    race → onConflictDoNothing → 0 rows → 409 already_pending).
 *  - GET → the caller's own payout request history, newest first.
 *
 * Money is always integer minor units.
 */

/**
 * Minimum withdrawal per currency (minor units). NPR minor = paisa (Rs 1,000),
 * USD minor = cents ($10). Below this the disbursement fees dwarf the payout.
 */
const MIN_PAYOUT_MINOR: Record<'NPR' | 'USD', number> = {
  NPR: 100_000,
  USD: 1_000,
};

const postSchema = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.enum(['NPR', 'USD']),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'coach.wallet.read');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { amountMinor, currency } = parsed.data;

  const minimum = MIN_PAYOUT_MINOR[currency];
  if (amountMinor < minimum) {
    return json({ error: 'below_minimum', minimumMinor: minimum, currency }, 400);
  }

  // Balance floor: recompute from the ledger at request time (never trust the
  // client). A coach cannot request more than they currently hold in that
  // currency. The admin re-checks the balance again at decision time.
  const balances = await coachWalletBalances(principal.id);
  const balanceMinor = balances.find((b) => b.currency === currency)?.amountMinor ?? 0;
  if (amountMinor > balanceMinor) {
    return json({ error: 'insufficient_balance', balanceMinor, currency }, 409);
  }

  const db = getDb();

  // The partial unique index (coach_id WHERE status='pending') is the real
  // guard against a concurrent double-POST; onConflictDoNothing turns a lost
  // race into 0 rows → already_pending.
  const inserted = await db
    .insert(coachPayoutRequests)
    .values({ coachId: principal.id, currency, amountMinor })
    .onConflictDoNothing()
    .returning({ id: coachPayoutRequests.id });

  const request = inserted[0];
  if (!request) return json({ error: 'already_pending' }, 409);

  await logAudit(
    principal,
    'payout.request',
    'coach_payout_request',
    request.id,
    { coachId: principal.id, amountMinor, currency },
    clientIp(req),
  );

  return json({ id: request.id }, 201);
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.wallet.read');
  if (principal instanceof Response) return principal;

  const rows = await getDb()
    .select({
      id: coachPayoutRequests.id,
      currency: coachPayoutRequests.currency,
      amountMinor: coachPayoutRequests.amountMinor,
      status: coachPayoutRequests.status,
      note: coachPayoutRequests.note,
      disbursementRef: coachPayoutRequests.disbursementRef,
      requestedAt: coachPayoutRequests.requestedAt,
      decidedAt: coachPayoutRequests.decidedAt,
    })
    .from(coachPayoutRequests)
    .where(eq(coachPayoutRequests.coachId, principal.id))
    .orderBy(desc(coachPayoutRequests.requestedAt))
    .limit(50);

  const requests = rows.map((r) => ({
    id: r.id,
    currency: r.currency,
    amountMinor: r.amountMinor,
    status: r.status,
    note: r.note,
    disbursementRef: r.disbursementRef,
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  }));

  return json({ requests }, 200);
}
