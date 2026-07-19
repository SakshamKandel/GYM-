import { accounts, coachPayoutRequests, coachProfiles, mealPartners, partnerPayoutRequests } from '@gym/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { coachWalletBalances } from '@/lib/promoEconomy';
import { loadPartnerHeld } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Admin console — the earner payout request queue (plan §3 P1-12 · WP-5 Pack I).
 * Lists PENDING requests (oldest-first, so nothing starves) plus a capped tail of
 * decided history. Each pending row carries the earner's CURRENT balance in the
 * requested currency so the admin can see, at a glance, whether the request is
 * still coverable before approving (the decide route re-checks it authoritatively).
 *
 *  - GET ?scope=coach (default) → coach payout queue (unchanged shape).
 *  - GET ?scope=partner         → partner payout queue (same shape, partner earner).
 *
 * Both return { pending: PayoutRow[], history: PayoutRow[] }. Guarded by
 * requirePermission('payouts.review'); super_admin/main_admin pass.
 */

const HISTORY_CAP = 100;

const querySchema = z.object({ scope: z.enum(['coach', 'partner']).default('coach') });

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

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ scope: url.searchParams.get('scope') ?? undefined });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  if (parsed.data.scope === 'partner') return partnerQueue(db);
  return coachQueue(db);
}

/** Coach payout queue — the original behavior (shape frozen; PayoutsQueue depends on it). */
async function coachQueue(db: ReturnType<typeof getDb>) {
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
  const coachIds = [...new Set([...pendingRows, ...historyRows].map((r) => r.coachId))];
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
      scope: 'coach',
      pending: pendingRows.map((r) => shape(r, true)),
      history: historyRows.map((r) => shape(r, false)),
    },
    200,
  );
}

/** Partner payout queue — the partner earner (mirrors the coach queue shape). */
async function partnerQueue(db: ReturnType<typeof getDb>) {
  const [pendingRows, historyRows] = await Promise.all([
    db
      .select({
        id: partnerPayoutRequests.id,
        partnerId: partnerPayoutRequests.partnerId,
        currency: partnerPayoutRequests.currency,
        amountMinor: partnerPayoutRequests.amountMinor,
        status: partnerPayoutRequests.status,
        note: partnerPayoutRequests.note,
        disbursementRef: partnerPayoutRequests.disbursementRef,
        requestedAt: partnerPayoutRequests.requestedAt,
        decidedAt: partnerPayoutRequests.decidedAt,
      })
      .from(partnerPayoutRequests)
      .where(eq(partnerPayoutRequests.status, 'pending'))
      .orderBy(asc(partnerPayoutRequests.requestedAt)),
    db
      .select({
        id: partnerPayoutRequests.id,
        partnerId: partnerPayoutRequests.partnerId,
        currency: partnerPayoutRequests.currency,
        amountMinor: partnerPayoutRequests.amountMinor,
        status: partnerPayoutRequests.status,
        note: partnerPayoutRequests.note,
        disbursementRef: partnerPayoutRequests.disbursementRef,
        requestedAt: partnerPayoutRequests.requestedAt,
        decidedAt: partnerPayoutRequests.decidedAt,
      })
      .from(partnerPayoutRequests)
      .where(inArray(partnerPayoutRequests.status, ['approved', 'rejected', 'paid']))
      .orderBy(desc(partnerPayoutRequests.decidedAt))
      .limit(HISTORY_CAP),
  ]);

  // Resolve partner identities for every row in one query.
  const partnerIds = [...new Set([...pendingRows, ...historyRows].map((r) => r.partnerId))];
  const partnerById = new Map<string, { id: string; name: string }>();
  if (partnerIds.length > 0) {
    const partnerRows = await db
      .select({ id: mealPartners.id, name: mealPartners.name })
      .from(mealPartners)
      .where(inArray(mealPartners.id, partnerIds));
    for (const p of partnerRows) partnerById.set(p.id, { id: p.id, name: p.name });
  }

  // Live held balance per pending partner (coverage preview; decided rows skip it).
  const pendingPartnerIds = [...new Set(pendingRows.map((r) => r.partnerId))];
  const heldByPartner = new Map<string, number>();
  await Promise.all(
    pendingPartnerIds.map(async (pid) => {
      const currency = pendingRows.find((r) => r.partnerId === pid)?.currency ?? 'NPR';
      const held = await loadPartnerHeld(db, pid, currency);
      heldByPartner.set(pid, held.heldMinor);
    }),
  );

  const shape = (r: (typeof pendingRows)[number], includeBalance: boolean) => {
    const partner = partnerById.get(r.partnerId) ?? { id: r.partnerId, name: r.partnerId };
    return {
      id: r.id,
      partner,
      currency: r.currency,
      amountMinor: r.amountMinor,
      status: r.status,
      note: r.note,
      disbursementRef: r.disbursementRef,
      balanceMinor: includeBalance ? heldByPartner.get(r.partnerId) ?? 0 : null,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    };
  };

  return json(
    {
      scope: 'partner',
      pending: pendingRows.map((r) => shape(r, true)),
      history: historyRows.map((r) => shape(r, false)),
    },
    200,
  );
}
