import {
  accounts,
  coachAssignments,
  coachMilestones,
  coachProfiles,
  mealPaymentRequests,
  paymentRequests,
  promoCodes,
  promoRedemptions,
  walletLedger,
} from '@gym/db';
import { and, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

/**
 * Platform analytics loader (plan §3 item 15, P2) — SHARED by the server-rendered
 * `/admin/analytics` page and the `GET /api/admin/analytics` API twin so the two
 * never drift. Everything here is a PURE read via getDb: server-side COUNT / SUM
 * GROUP BY aggregates only — no per-row client-side math, no PII beyond coach
 * identity (owner/coach display names, which are staff, not members).
 *
 * Callers MUST have already enforced `analytics.read` (super/main only) — this
 * module does no auth of its own.
 */

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';
export type CoachTier = 'silver' | 'gold' | 'elite';

const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

/** A signed minor-unit amount in one currency (paisa/cents). */
export interface CurrencyAmount {
  currency: string;
  amountMinor: number;
}

/** One month bucket of net revenue, one figure per observed currency. */
export interface RevenueMonth {
  month: string; // 'YYYY-MM'
  totals: CurrencyAmount[]; // one entry per currency in `currencies`, 0 when none
}

export interface PromoPerformance {
  codeId: string;
  code: string;
  ownerName: string | null; // coach display name / email — null for house codes
  active: boolean;
  commissionPct: number;
  redemptions: number; // total promo_redemptions rows
  settlements: number; // redemptions that reached status='applied'
  commission: CurrencyAmount[]; // paid commission per currency (settled redemptions)
}

export interface CoachPerformance {
  coachId: string;
  displayName: string;
  coachTier: CoachTier;
  activeClients: number;
  totalMilestones: number;
  walletEarned: CurrencyAmount[]; // gross commission credited, per currency
}

export interface TierCount {
  tier: Tier;
  count: number;
}

export interface CountryCount {
  country: string | null; // null = country unknown
  count: number;
}

/**
 * Trailing-30-day figures against the preceding 30 days. Percentages are derived
 * in the UI so the payload stays pure numbers.
 */
export interface PeriodDeltas {
  windowDays: number;
  revenue: { currency: string; current: number; prior: number }[];
  newMembers: { current: number; prior: number };
  approvedPayments: { current: number; prior: number };
}

export interface AnalyticsData {
  revenueByMonth: RevenueMonth[]; // chronological, oldest → newest (12 buckets)
  currencies: string[]; // every currency observed in revenueByMonth
  promoPerformance: PromoPerformance[];
  coachPerformance: CoachPerformance[];
  tierBreakdown: TierCount[];
  countryBreakdown: CountryCount[];
  deltas: PeriodDeltas;
  generatedAt: string; // ISO
}

/**
 * Effective-tier SQL: a paid tier whose window has lapsed collapses to 'starter'
 * (mirrors effectiveTier() in @gym/shared / the overview twin) so the snapshot
 * can't count lapsed members as paid.
 */
const effectiveTierSql = sql<Tier>`CASE
  WHEN ${accounts.tier} <> 'starter'
   AND ${accounts.tierExpiresAt} IS NOT NULL
   AND ${accounts.tierExpiresAt} <= now()
  THEN 'starter'
  ELSE ${accounts.tier}
END`;

/** Sums a list of {currency, amt-as-text} rows into a currency→minor map. */
function sumByCurrency(rows: { currency: string; amt: string | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    // Cast-to-text then Number(): a raw ::int sum overflows past ~21.4M minor
    // units (E12). Number() on the text keeps full precision to 2^53.
    out.set(r.currency, (out.get(r.currency) ?? 0) + Number(r.amt ?? 0));
  }
  return out;
}

/** UTC month key ('YYYY-MM') for a Date. */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Single read pass for the analytics dashboard. */
export async function loadAnalytics(): Promise<AnalyticsData> {
  const db = getDb();
  const now = new Date();
  // First day (UTC) of the month 11 months back → 12 inclusive month buckets.
  const revenueStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const dayMs = 24 * 60 * 60 * 1000;
  const curStart = new Date(now.getTime() - 30 * dayMs);
  const priorStart = new Date(now.getTime() - 60 * dayMs);

  const [
    revenue,
    promo,
    coaches,
    tierBreakdown,
    countryBreakdown,
    deltas,
  ] = await Promise.all([
    loadRevenueByMonth(revenueStart, now),
    loadPromoPerformance(),
    loadCoachPerformance(),
    loadTierBreakdown(),
    loadCountryBreakdown(),
    loadDeltas(curStart, priorStart, now),
  ]);

  return {
    revenueByMonth: revenue.revenueByMonth,
    currencies: revenue.currencies,
    promoPerformance: promo,
    coachPerformance: coaches,
    tierBreakdown,
    countryBreakdown,
    deltas,
    generatedAt: now.toISOString(),
  };
}

/**
 * (a) Net revenue by month × currency for the last 12 months.
 *
 * A payment is recognised in the month it was GRANTED (tier_granted_at, falling
 * back to decided_at / created_at for legacy rows) and a refund is subtracted in
 * the month it was DECIDED (decided_at is re-stamped to the refund time). Because
 * a refunded row is counted +amount at grant AND −amount at refund, a purchase
 * refunded inside the window nets to ~0, while one refunded in a later month
 * correctly reduces that later month — this is what "respect refunded rows as
 * negatives" means for a net-revenue view.
 *
 * P1-10: the SAME net-revenue treatment is applied to `meal_payment_requests`
 * (the meal-delivery vertical) so finance figures aren't blind to meal money.
 * Meal rows have no tier_granted_at, so the grant anchor is the refund-stable
 * settled_at→created_at (NOT decided_at, which the refund route re-stamps to the
 * refund time — anchoring there would erase the earned month's revenue) and the
 * refund anchor is refunded_at→decided_at; amounts merge into the same
 * per-currency buckets (NPR overlaps membership revenue).
 */
async function loadRevenueByMonth(
  windowStart: Date,
  now: Date,
): Promise<{ revenueByMonth: RevenueMonth[]; currencies: string[] }> {
  const db = getDb();

  // Grant month anchor — survives a later refund (which only re-stamps decidedAt).
  const grantAnchor = sql`coalesce(${paymentRequests.tierGrantedAt}, ${paymentRequests.decidedAt}, ${paymentRequests.createdAt})`;
  const grantMonth = sql<string>`to_char(date_trunc('month', ${grantAnchor}), 'YYYY-MM')`;
  const refundMonth = sql<string>`to_char(date_trunc('month', ${paymentRequests.decidedAt}), 'YYYY-MM')`;

  // Meal-payment anchors (no tier_granted_at column on this table). The grant
  // leg must anchor on a refund-STABLE column: the refund route re-stamps
  // decidedAt to the refund time, so anchoring on decidedAt would erase a
  // refunded payment's revenue from the month it was actually earned. settledAt
  // (stamped once when the payment settles, never touched by refund) → createdAt
  // (immutable) is stable across a later refund.
  const mealGrantAnchor = sql`coalesce(${mealPaymentRequests.settledAt}, ${mealPaymentRequests.createdAt})`;
  const mealGrantMonth = sql<string>`to_char(date_trunc('month', ${mealGrantAnchor}), 'YYYY-MM')`;
  const mealRefundAnchor = sql`coalesce(${mealPaymentRequests.refundedAt}, ${mealPaymentRequests.decidedAt})`;
  const mealRefundMonth = sql<string>`to_char(date_trunc('month', ${mealRefundAnchor}), 'YYYY-MM')`;

  const [grossRows, refundRows, mealGrossRows, mealRefundRows] = await Promise.all([
    // Positive leg: every row that was ever approved (approved OR later refunded).
    db
      .select({
        month: grantMonth,
        currency: paymentRequests.currency,
        amt: sql<string>`sum(${paymentRequests.amountMinor})::text`,
      })
      .from(paymentRequests)
      .where(
        and(
          inArray(paymentRequests.status, ['approved', 'refunded']),
          sql`${grantAnchor} >= ${windowStart}`,
        ),
      )
      .groupBy(grantMonth, paymentRequests.currency),
    // Negative leg: refunds, subtracted in the month the refund was decided.
    db
      .select({
        month: refundMonth,
        currency: paymentRequests.currency,
        amt: sql<string>`sum(${paymentRequests.amountMinor})::text`,
      })
      .from(paymentRequests)
      .where(and(eq(paymentRequests.status, 'refunded'), gte(paymentRequests.decidedAt, windowStart)))
      .groupBy(refundMonth, paymentRequests.currency),
    // Meal positive leg.
    db
      .select({
        month: mealGrantMonth,
        currency: mealPaymentRequests.currency,
        amt: sql<string>`sum(${mealPaymentRequests.amountMinor})::text`,
      })
      .from(mealPaymentRequests)
      .where(
        and(
          inArray(mealPaymentRequests.status, ['approved', 'refunded']),
          sql`${mealGrantAnchor} >= ${windowStart}`,
        ),
      )
      .groupBy(mealGrantMonth, mealPaymentRequests.currency),
    // Meal negative leg.
    db
      .select({
        month: mealRefundMonth,
        currency: mealPaymentRequests.currency,
        amt: sql<string>`sum(${mealPaymentRequests.amountMinor})::text`,
      })
      .from(mealPaymentRequests)
      .where(
        and(
          eq(mealPaymentRequests.status, 'refunded'),
          sql`${mealRefundAnchor} >= ${windowStart}`,
        ),
      )
      .groupBy(mealRefundMonth, mealPaymentRequests.currency),
  ]);

  // net[month][currency] = gross − refunds
  const net = new Map<string, Map<string, number>>();
  const currencies = new Set<string>();
  const apply = (month: string | null, currency: string, delta: number) => {
    if (!month) return;
    currencies.add(currency);
    let row = net.get(month);
    if (!row) {
      row = new Map();
      net.set(month, row);
    }
    row.set(currency, (row.get(currency) ?? 0) + delta);
  };
  for (const r of grossRows) apply(r.month, r.currency, Number(r.amt ?? 0));
  for (const r of refundRows) apply(r.month, r.currency, -Number(r.amt ?? 0));
  for (const r of mealGrossRows) apply(r.month, r.currency, Number(r.amt ?? 0));
  for (const r of mealRefundRows) apply(r.month, r.currency, -Number(r.amt ?? 0));

  // Emit all 12 buckets in order, each carrying every observed currency (0 when
  // absent) so the rendered table has uniform columns.
  const currencyList = [...currencies].sort();
  const revenueByMonth: RevenueMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth() + i, 1));
    if (d > now) break;
    const key = monthKey(d);
    const row = net.get(key);
    revenueByMonth.push({
      month: key,
      totals: currencyList.map((currency) => ({
        currency,
        amountMinor: row?.get(currency) ?? 0,
      })),
    });
  }

  return { revenueByMonth, currencies: currencyList };
}

/**
 * (b) Promo performance per code: redemptions → settlements → commission paid.
 * `commissionMinor` is stamped on each redemption at settlement (the same figure
 * credited to the coach's wallet_ledger), so summing it per code gives the paid
 * commission without a fragile wallet_ledger↔code join.
 */
async function loadPromoPerformance(): Promise<PromoPerformance[]> {
  const db = getDb();

  const [counts, commissionRows] = await Promise.all([
    // One row per code: total redemptions + settled redemptions, joined to owner.
    db
      .select({
        codeId: promoCodes.id,
        code: promoCodes.code,
        active: promoCodes.active,
        commissionPct: promoCodes.commissionPct,
        ownerDisplayName: accounts.displayName,
        ownerEmail: accounts.email,
        redemptions: count(promoRedemptions.id),
        settlements: sql<string>`count(*) filter (where ${promoRedemptions.status} = 'applied')::text`,
      })
      .from(promoCodes)
      .leftJoin(promoRedemptions, eq(promoRedemptions.codeId, promoCodes.id))
      .leftJoin(accounts, eq(accounts.id, promoCodes.ownerCoachId))
      .groupBy(
        promoCodes.id,
        promoCodes.code,
        promoCodes.active,
        promoCodes.commissionPct,
        accounts.displayName,
        accounts.email,
      )
      .orderBy(desc(count(promoRedemptions.id)))
      .limit(100),
    // Paid commission per (code, currency) over settled redemptions.
    db
      .select({
        codeId: promoRedemptions.codeId,
        currency: promoRedemptions.currency,
        amt: sql<string>`sum(${promoRedemptions.commissionMinor})::text`,
      })
      .from(promoRedemptions)
      .where(and(eq(promoRedemptions.status, 'applied'), sql`${promoRedemptions.currency} is not null`))
      .groupBy(promoRedemptions.codeId, promoRedemptions.currency),
  ]);

  const commissionByCode = new Map<string, CurrencyAmount[]>();
  for (const r of commissionRows) {
    if (!r.currency) continue;
    const list = commissionByCode.get(r.codeId) ?? [];
    list.push({ currency: r.currency, amountMinor: Number(r.amt ?? 0) });
    commissionByCode.set(r.codeId, list);
  }

  return counts.map((r) => ({
    codeId: r.codeId,
    code: r.code,
    active: r.active,
    commissionPct: r.commissionPct,
    ownerName: r.ownerDisplayName ? r.ownerDisplayName : (r.ownerEmail ?? null),
    redemptions: Number(r.redemptions ?? 0),
    settlements: Number(r.settlements ?? 0),
    commission: (commissionByCode.get(r.codeId) ?? []).sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
  }));
}

/**
 * (c) Coach performance: active clients, total milestones, wallet earned. Roster
 * is the coach_profiles table; per-coach aggregates are grouped then joined in
 * memory (revoked coaches with outstanding balances but no profile row surface
 * on the Wallets screen instead — this view is about active coaching output).
 */
async function loadCoachPerformance(): Promise<CoachPerformance[]> {
  const db = getDb();

  const [roster, clientRows, milestoneRows, earnedRows] = await Promise.all([
    db
      .select({
        coachId: coachProfiles.accountId,
        displayName: coachProfiles.displayName,
        coachTier: coachProfiles.coachTier,
      })
      .from(coachProfiles),
    db
      .select({ coachId: coachAssignments.coachId, n: count() })
      .from(coachAssignments)
      .where(eq(coachAssignments.status, 'active'))
      .groupBy(coachAssignments.coachId),
    db
      .select({ coachId: coachMilestones.coachId, n: count() })
      .from(coachMilestones)
      .groupBy(coachMilestones.coachId),
    db
      .select({
        coachId: walletLedger.coachId,
        currency: walletLedger.currency,
        amt: sql<string>`sum(${walletLedger.amountMinor})::text`,
      })
      .from(walletLedger)
      .where(eq(walletLedger.type, 'commission'))
      .groupBy(walletLedger.coachId, walletLedger.currency),
  ]);

  const clients = new Map<string, number>();
  for (const r of clientRows) clients.set(r.coachId, Number(r.n));
  const milestones = new Map<string, number>();
  for (const r of milestoneRows) milestones.set(r.coachId, Number(r.n));
  const earned = new Map<string, CurrencyAmount[]>();
  for (const r of earnedRows) {
    const list = earned.get(r.coachId) ?? [];
    list.push({ currency: r.currency, amountMinor: Number(r.amt ?? 0) });
    earned.set(r.coachId, list);
  }

  return roster
    .map((c) => ({
      coachId: c.coachId,
      displayName: c.displayName || 'Coach',
      coachTier: c.coachTier,
      activeClients: clients.get(c.coachId) ?? 0,
      totalMilestones: milestones.get(c.coachId) ?? 0,
      walletEarned: (earned.get(c.coachId) ?? []).sort((a, b) =>
        a.currency.localeCompare(b.currency),
      ),
    }))
    .sort(
      (a, b) => b.activeClients - a.activeClients || b.totalMilestones - a.totalMilestones,
    )
    .slice(0, 100);
}

/** (d) Effective-tier snapshot across all accounts. */
async function loadTierBreakdown(): Promise<TierCount[]> {
  const rows = await getDb()
    .select({ tier: effectiveTierSql, n: count() })
    .from(accounts)
    .groupBy(effectiveTierSql);
  const byTier = new Map<Tier, number>();
  for (const r of rows) byTier.set(r.tier as Tier, Number(r.n));
  return TIER_ORDER.map((tier) => ({ tier, count: byTier.get(tier) ?? 0 }));
}

/** (d) Country breakdown (accounts.country) — top 20, null = unknown. */
async function loadCountryBreakdown(): Promise<CountryCount[]> {
  const rows = await getDb()
    .select({ country: accounts.country, n: count() })
    .from(accounts)
    .groupBy(accounts.country)
    .orderBy(desc(count()))
    .limit(20);
  return rows.map((r) => ({ country: r.country ?? null, count: Number(r.n) }));
}

/** (e) Trailing-30-day vs prior-30-day deltas. */
async function loadDeltas(
  curStart: Date,
  priorStart: Date,
  now: Date,
): Promise<PeriodDeltas> {
  const db = getDb();

  // Net approved revenue in [start, end) by currency (refunds subtract).
  // P1-10: membership + meal-delivery payments are summed into the same
  // per-currency buckets so the delta reflects total platform revenue.
  const revenueBetween = async (start: Date, end: Date): Promise<Map<string, number>> => {
    const [membershipRows, mealRows] = await Promise.all([
      db
        .select({
          currency: paymentRequests.currency,
          amt: sql<string>`sum(case when ${paymentRequests.status} = 'refunded' then -${paymentRequests.amountMinor} else ${paymentRequests.amountMinor} end)::text`,
        })
        .from(paymentRequests)
        .where(
          and(
            inArray(paymentRequests.status, ['approved', 'refunded']),
            gte(paymentRequests.decidedAt, start),
            lt(paymentRequests.decidedAt, end),
          ),
        )
        .groupBy(paymentRequests.currency),
      db
        .select({
          currency: mealPaymentRequests.currency,
          amt: sql<string>`sum(case when ${mealPaymentRequests.status} = 'refunded' then -${mealPaymentRequests.amountMinor} else ${mealPaymentRequests.amountMinor} end)::text`,
        })
        .from(mealPaymentRequests)
        .where(
          and(
            inArray(mealPaymentRequests.status, ['approved', 'refunded']),
            gte(mealPaymentRequests.decidedAt, start),
            lt(mealPaymentRequests.decidedAt, end),
          ),
        )
        .groupBy(mealPaymentRequests.currency),
    ]);
    return sumByCurrency([...membershipRows, ...mealRows]);
  };

  const membersBetween = async (start: Date, end: Date): Promise<number> => {
    const [r] = await db
      .select({ n: count() })
      .from(accounts)
      .where(and(gte(accounts.createdAt, start), lt(accounts.createdAt, end)));
    return Number(r?.n ?? 0);
  };

  // Approved manual payments in [start, end) — membership + meal verticals.
  const approvalsBetween = async (start: Date, end: Date): Promise<number> => {
    const [membership, meal] = await Promise.all([
      db
        .select({ n: count() })
        .from(paymentRequests)
        .where(
          and(
            eq(paymentRequests.status, 'approved'),
            gte(paymentRequests.decidedAt, start),
            lt(paymentRequests.decidedAt, end),
          ),
        ),
      db
        .select({ n: count() })
        .from(mealPaymentRequests)
        .where(
          and(
            eq(mealPaymentRequests.status, 'approved'),
            gte(mealPaymentRequests.decidedAt, start),
            lt(mealPaymentRequests.decidedAt, end),
          ),
        ),
    ]);
    return Number(membership[0]?.n ?? 0) + Number(meal[0]?.n ?? 0);
  };

  const [
    curRevenue,
    priorRevenue,
    curMembers,
    priorMembers,
    curApprovals,
    priorApprovals,
  ] = await Promise.all([
    revenueBetween(curStart, now),
    revenueBetween(priorStart, curStart),
    membersBetween(curStart, now),
    membersBetween(priorStart, curStart),
    approvalsBetween(curStart, now),
    approvalsBetween(priorStart, curStart),
  ]);

  const currencies = new Set<string>([...curRevenue.keys(), ...priorRevenue.keys()]);
  const revenue = [...currencies].sort().map((currency) => ({
    currency,
    current: curRevenue.get(currency) ?? 0,
    prior: priorRevenue.get(currency) ?? 0,
  }));

  return {
    windowDays: 30,
    revenue,
    newMembers: { current: curMembers, prior: priorMembers },
    approvedPayments: { current: curApprovals, prior: priorApprovals },
  };
}
