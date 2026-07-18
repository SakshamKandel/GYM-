import { coachPayoutRequests, promoCodes, walletLedger } from '@gym/db';
import { and, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { coachWalletBalances } from '@/lib/promoEconomy';
import { staffFromCookie } from '@/lib/staffSession';
import {
  CoachWalletView,
  type LedgerEntry,
  type PayoutRequest,
  type WalletBalance,
} from './_components/CoachWalletView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coach console — wallet page (plan §3 P1-13: web parity for what was previously
 * a mobile-only coach surface). Server component: resolves the signed-in coach
 * from the 'gt_staff' cookie (the layout guards, but we re-resolve to fail safe
 * and get the id), then loads their OWN wallet: per-currency balances, the
 * newest ledger entries, their active promo code, and their payout request
 * history. The client view renders those and hosts the request-payout form,
 * which POSTs /api/coach/payouts.
 *
 * All reads are self-scoped to the coach's account id — a coach can only ever
 * see their own wallet here (the admin console owns the cross-coach view).
 */

const ENTRY_LIMIT = 50;

export default async function CoachWalletPage() {
  const coach = await staffFromCookie();
  if (!coach) redirect('/coach/login');

  const db = getDb();

  const [balances, entryRows, codeRows, payoutRows] = await Promise.all([
    coachWalletBalances(coach.id),
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
      .where(eq(walletLedger.coachId, coach.id))
      .orderBy(desc(walletLedger.createdAt))
      .limit(ENTRY_LIMIT),
    db
      .select({
        code: promoCodes.code,
        discountPct: promoCodes.discountPct,
        commissionPct: promoCodes.commissionPct,
        redemptionCount: promoCodes.redemptionCount,
      })
      .from(promoCodes)
      .where(and(eq(promoCodes.ownerCoachId, coach.id), eq(promoCodes.active, true)))
      .orderBy(desc(promoCodes.createdAt))
      .limit(1),
    db
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
      .where(eq(coachPayoutRequests.coachId, coach.id))
      .orderBy(desc(coachPayoutRequests.requestedAt))
      .limit(25),
  ]);

  const walletBalances: WalletBalance[] = balances.map((b) => ({
    currency: b.currency,
    amountMinor: b.amountMinor,
  }));

  const entries: LedgerEntry[] = entryRows.map((e) => ({
    id: e.id,
    type: e.type,
    amountMinor: e.amountMinor,
    currency: e.currency,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  }));

  const payouts: PayoutRequest[] = payoutRows.map((p) => ({
    id: p.id,
    currency: p.currency,
    amountMinor: p.amountMinor,
    status: p.status,
    note: p.note,
    disbursementRef: p.disbursementRef,
    requestedAt: p.requestedAt.toISOString(),
    decidedAt: p.decidedAt ? p.decidedAt.toISOString() : null,
  }));

  const code = codeRows[0] ?? null;

  return (
    <div style={{ maxWidth: 760 }}>
      <PageHeader
        title="Wallet"
        subtitle="Your commission balance from promo-coded purchases. Request a payout once you clear the minimum — an admin reviews and disburses it."
      />
      <CoachWalletView
        balances={walletBalances}
        entries={entries}
        payouts={payouts}
        code={code}
      />
    </div>
  );
}
