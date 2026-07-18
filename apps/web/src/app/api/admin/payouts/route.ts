import { accounts, coachPayoutRequests, coachProfiles } from '@gym/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { coachWalletBalances } from '@/lib/promoEconomy';

export const runtime = 'nodejs';

/**
 * Admin console — the coach payout request queue (plan §3 P1-12). Lists PENDING
 * requests (oldest-first, so nothing starves) plus a capped tail of decided
 * history. Each pending row carries the coach's CURRENT ledger balance in the
 * requested currency so the admin can see, at a glance, whether the request is
 * still coverable before approving (the decide route re-checks it authoritatively).
 *
 *  - GET → { pending: PayoutRow[], history: PayoutRow[] }.
 *
 * Guarded by requirePermission('payouts.review'); super_admin/main_admin pass.
 */

const HISTORY_CAP = 100;

interface CoachRef {
  id: string;
  displayName: string;
  coachTier: string;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'payouts.review');
  if (principal instanceof Response) return principal;

  const db = getDb();

  const [pendingRows, historyRows] = await Promise.all([
    db
      .select({
        id: coachPayoutRequests.id,
        coachId: coachPayoutRequests.coachId,
        currency: coachPayoutRequests.currency,
        amountMinor: coachPayoutRequests.amountMinor,
        status: coachPayoutRequests.status,
        note: coachPayoutRequests.note,
        disbursementRef: coachPayoutRequests.disbursementRef,
        requestedAt: coachPayoutRequests.requestedAt,
        decidedAt: coachPayoutRequests.decidedAt,
      })
      .from(coachPayoutRequests)
      .where(eq(coachPayoutRequests.status, 'pending'))
      .orderBy(asc(coachPayoutRequests.requestedAt)),
    db
      .select({
        id: coachPayoutRequests.id,
        coachId: coachPayoutRequests.coachId,
        currency: coachPayoutRequests.currency,
        amountMinor: coachPayoutRequests.amountMinor,
        status: coachPayoutRequests.status,
        note: coachPayoutRequests.note,
        disbursementRef: coachPayoutRequests.disbursementRef,
        requestedAt: coachPayoutRequests.requestedAt,
        decidedAt: coachPayoutRequests.decidedAt,
      })
      .from(coachPayoutRequests)
      .where(inArray(coachPayoutRequests.status, ['approved', 'rejected', 'paid']))
      .orderBy(desc(coachPayoutRequests.decidedAt))
      .limit(HISTORY_CAP),
  ]);

  // Resolve coach identities for every row in one query.
  const coachIds = [
    ...new Set([...pendingRows, ...historyRows].map((r) => r.coachId)),
  ];
  const coachById = new Map<string, CoachRef>();
  if (coachIds.length > 0) {
    const coachRows = await db
      .select({
        id: accounts.id,
        accountName: accounts.displayName,
        profileName: coachProfiles.displayName,
        coachTier: coachProfiles.coachTier,
      })
      .from(accounts)
      .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
      .where(inArray(accounts.id, coachIds));
    for (const c of coachRows) {
      coachById.set(c.id, {
        id: c.id,
        displayName: c.profileName?.trim() ? c.profileName : c.accountName,
        coachTier: c.coachTier ?? 'silver',
      });
    }
  }

  // Only pending rows need a live balance (to preview coverage); decided rows
  // are historical. Balances are recomputed per coach from the ledger.
  const pendingCoachIds = [...new Set(pendingRows.map((r) => r.coachId))];
  const balanceByCoach = new Map<string, { currency: string; amountMinor: number }[]>();
  await Promise.all(
    pendingCoachIds.map(async (cid) => {
      balanceByCoach.set(cid, await coachWalletBalances(cid));
    }),
  );

  const shape = (r: (typeof pendingRows)[number], includeBalance: boolean) => {
    const coach = coachById.get(r.coachId) ?? {
      id: r.coachId,
      displayName: r.coachId,
      coachTier: 'silver',
    };
    const balanceMinor = includeBalance
      ? balanceByCoach.get(r.coachId)?.find((b) => b.currency === r.currency)?.amountMinor ?? 0
      : null;
    return {
      id: r.id,
      coach,
      currency: r.currency,
      amountMinor: r.amountMinor,
      status: r.status,
      note: r.note,
      disbursementRef: r.disbursementRef,
      balanceMinor,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    };
  };

  return json(
    {
      pending: pendingRows.map((r) => shape(r, true)),
      history: historyRows.map((r) => shape(r, false)),
    },
    200,
  );
}
