import {
  accounts,
  discountGrants,
  promoCodes,
  promoRedemptions,
  referrals,
  tierPrices,
  walletLedger,
} from '@gym/db';
import {
  applyDiscount,
  DEFAULT_TIER_PRICES,
  resolveRegion,
  type PriceRegion,
  type Tier,
} from '@gym/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { getDb } from './db';

/**
 * Promo economy: the best-active-discount-wins ledger the pricing catalog
 * reads, and the settlement hook that consumes a grant + credits the owning
 * coach's wallet when a paid purchase actually lands (SCALE-UP-PLAN §1.3 /
 * §4.1). Nothing here is staff-triggered, so none of it goes through
 * logAudit — the discount_grants / promo_redemptions / wallet_ledger rows
 * ARE the audit trail.
 */

export interface ActiveGrant {
  id: string;
  source: 'referral' | 'promo';
  promoCodeId: string | null;
  pct: number;
  expiresAt: Date | null;
}

/**
 * Lazily expires this account's past-due 'active' grants, then returns the
 * best still-active one: highest pct wins, newest createdAt breaks ties.
 * `null` when there's no active, non-expired grant. A null `expiresAt` never
 * expires (drizzle's `lt` against NULL never matches, so those rows are
 * untouched by the expiry sweep).
 */
export async function bestActiveGrant(accountId: string): Promise<ActiveGrant | null> {
  const db = getDb();
  const now = new Date();

  await db
    .update(discountGrants)
    .set({ status: 'expired' })
    .where(
      and(
        eq(discountGrants.accountId, accountId),
        eq(discountGrants.status, 'active'),
        lt(discountGrants.expiresAt, now),
      ),
    );

  const rows = await db
    .select({
      id: discountGrants.id,
      source: discountGrants.source,
      promoCodeId: discountGrants.promoCodeId,
      pct: discountGrants.pct,
      expiresAt: discountGrants.expiresAt,
    })
    .from(discountGrants)
    .where(and(eq(discountGrants.accountId, accountId), eq(discountGrants.status, 'active')))
    .orderBy(desc(discountGrants.pct), desc(discountGrants.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

export interface GrantDiscountArgs {
  accountId: string;
  source: 'referral' | 'promo';
  pct: number;
  promoCodeId?: string | null;
  expiresAt?: Date | null;
}

/**
 * Grants a new discount for an account, enforcing SCALE-UP-PLAN §1.3's "only
 * ONE active grant per account — best discount wins, newest breaks ties":
 * the new grant becomes 'active' (superseding every other active grant) only
 * when its pct is >= the account's current best active pct; a strictly worse
 * grant is inserted already 'expired', leaving the existing better grant
 * untouched. Returns the new grant's id either way (the row is always kept
 * as part of the audit trail, per this module's header comment).
 *
 * The compare-then-write is a single statement (CTE), so it stays correct
 * under concurrent redemptions by the same account: Postgres evaluates the
 * `current_best` snapshot once per statement and the UPDATE takes a row lock
 * on the account's active grant(s) before the second concurrent call's CTE
 * can run, so two racing grants of different pct can never both end up
 * 'active' (and the neon-http driver has no multi-statement transaction
 * support, so this couldn't otherwise be wrapped in a BEGIN/COMMIT).
 */
export async function grantDiscount(args: GrantDiscountArgs): Promise<string> {
  const db = getDb();
  const accountId = args.accountId;
  const pct = args.pct;

  const result = await db.execute<{ id: string }>(sql`
    with current_best as (
      select coalesce(max(pct), -1) as best_pct
      from discount_grants
      where account_id = ${accountId} and status = 'active'
    ),
    expired as (
      update discount_grants
      set status = 'expired'
      where account_id = ${accountId}
        and status = 'active'
        and ${pct} >= (select best_pct from current_best)
      returning id
    )
    insert into discount_grants (account_id, source, promo_code_id, pct, status, expires_at)
    select
      ${accountId},
      ${args.source},
      ${args.promoCodeId ?? null},
      ${pct},
      case when ${pct} >= (select best_pct from current_best) then 'active' else 'expired' end,
      ${args.expiresAt ?? null}
    returning id
  `);

  const row = result.rows[0];
  if (!row) throw new Error('grantDiscount: insert returned no row');
  return row.id;
}

/**
 * Resolves the base (pre-discount) catalog price for `tier` in the region
 * associated with `accountId` (accounts.country → resolveRegion → 'INTL'
 * fallback): an active tier_prices row if one exists, else the shared
 * DEFAULT_TIER_PRICES constant. Used by purchase-settlement call sites
 * (subscription/tier preview grants, the RevenueCat webhook) to get an
 * amountMinor for settlePromoOnPurchase's commission math when there is no
 * verified real sale price to read — preview mode has none, and RevenueCat's
 * webhook payload strips price fields entirely.
 *
 * `regionOverride` lets a caller that already resolved the region itself
 * (POST /api/payments/requests accepts an explicit `region` hint per-request,
 * independent of the account's stored country) skip the accounts.country
 * lookup entirely. Omitted by the original two call sites, which keep
 * resolving off the stored country exactly as before.
 */
export async function resolveCatalogAmount(
  accountId: string,
  tier: Tier,
  regionOverride?: PriceRegion,
): Promise<{ amountMinor: number; currency: string }> {
  const db = getDb();

  let region: PriceRegion;
  if (regionOverride) {
    region = regionOverride;
  } else {
    const [account] = await db
      .select({ country: accounts.country })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    region = resolveRegion(account?.country ?? null);
  }

  const [row] = await db
    .select({ amountMinor: tierPrices.amountMinor, currency: tierPrices.currency })
    .from(tierPrices)
    .where(
      and(eq(tierPrices.region, region), eq(tierPrices.tier, tier), eq(tierPrices.active, true)),
    )
    .limit(1);
  if (row) return row;

  const fallback = DEFAULT_TIER_PRICES.find((p) => p.region === region && p.tier === tier);
  return fallback
    ? { amountMinor: fallback.amountMinor, currency: fallback.currency }
    : { amountMinor: 0, currency: region === 'NP' ? 'NPR' : 'USD' };
}

export type SettleMode = 'preview' | 'live' | 'manual';

/**
 * Settles the account's currently-active discount grant against a completed
 * PAID-tier purchase (SCALE-UP-PLAN §4.1). Callers: POST /api/subscription/tier
 * (mode 'preview', after a self-serve paid pick), the RevenueCat webhook (mode
 * 'live', after an entitlement grant), and POST /api/admin/payment-requests/[id]
 * approve (mode 'manual', after a staff-approved Nepal payment request). Starter
 * picks never settle — callers should not invoke this for them, but it's a
 * no-op if they do.
 *
 * `amountMinor` is the PRE-discount catalog price (what callers resolve via
 * resolveCatalogAmount — neither call site has a verified real sale price to
 * pass). §1.3 defines commission off the price actually PAID, so this
 * function applies the consumed grant's own pct to `amountMinor` before
 * computing commission — never the undiscounted catalog figure.
 *
 * - No active grant → no-op.
 * - Consumes the grant (status 'consumed') regardless of source.
 * - source 'promo': finds this account's 'reserved' promo_redemptions row for
 *   the grant's code, marks it 'applied' with the discounted purchase amount,
 *   computes commissionMinor = round(pricePaidMinor * commissionPct / 100)
 *   where pricePaidMinor = applyDiscount(amountMinor, grant.pct), and credits
 *   the code-owning coach's wallet — idempotent via the wallet_ledger unique
 *   (sourceType, sourceId) index (sourceId = the redemption's id), so a
 *   retried webhook or a double self-serve call never double-credits.
 *   Skipped when the code has no owner (house code), the commission is 0, OR
 *   mode is 'preview': no real money moved, so the redemption is still marked
 *   'applied' (bookkeeping/UI stay accurate) but NO wallet_ledger row is
 *   inserted — crediting a real, payable commission balance off a free
 *   preview-mode tier pick would let a coach farm fake payable revenue via
 *   member accounts they control (GET /api/admin/wallets surfaces the balance
 *   for actual payout). Once BILLING_MODE flips to 'live' this branch never
 *   fires again for that redemption (it's already 'applied').
 * - source 'referral': flips every 'joined' referral row where this account
 *   is EITHER the referrer or the invitee to 'rewarded' (a referral grant has
 *   no back-reference to a specific referral row, so this is a best-effort
 *   settle-on-first-purchase by either party — matches SCALE-UP-PLAN §7.2's
 *   "purchase consumes the grant, row flips 'rewarded'").
 */
export async function settlePromoOnPurchase(
  accountId: string,
  tier: Tier,
  amountMinor: number,
  currency: string,
  mode: SettleMode,
): Promise<void> {
  if (tier === 'starter') return;

  const grant = await bestActiveGrant(accountId);
  if (!grant) return;

  const db = getDb();

  await db
    .update(discountGrants)
    .set({ status: 'consumed', consumedAt: new Date() })
    .where(eq(discountGrants.id, grant.id));

  if (grant.source === 'promo') {
    if (!grant.promoCodeId) return;

    const [code] = await db
      .select({
        id: promoCodes.id,
        ownerCoachId: promoCodes.ownerCoachId,
        commissionPct: promoCodes.commissionPct,
      })
      .from(promoCodes)
      .where(eq(promoCodes.id, grant.promoCodeId))
      .limit(1);
    if (!code) return;

    const [redemption] = await db
      .select({ id: promoRedemptions.id, status: promoRedemptions.status })
      .from(promoRedemptions)
      .where(
        and(eq(promoRedemptions.codeId, code.id), eq(promoRedemptions.accountId, accountId)),
      )
      .limit(1);
    // Idempotency: already applied (a retried webhook or duplicate call) —
    // the grant is consumed above either way, but never re-settle the ledger.
    if (!redemption || redemption.status === 'applied') return;

    // Commission is computed on what was actually paid under this grant's
    // discount, not the undiscounted catalog figure (SCALE-UP-PLAN §1.3).
    const pricePaidMinor = applyDiscount(amountMinor, grant.pct);
    const commissionMinor = Math.round((pricePaidMinor * code.commissionPct) / 100);

    await db
      .update(promoRedemptions)
      .set({
        status: 'applied',
        purchaseAmountMinor: pricePaidMinor,
        currency,
        commissionMinor,
        appliedAt: new Date(),
      })
      .where(eq(promoRedemptions.id, redemption.id));

    // Preview mode moves no real money — never credit a real, payable
    // commission balance for it (see doc comment above).
    if (code.ownerCoachId && commissionMinor > 0 && mode !== 'preview') {
      await db
        .insert(walletLedger)
        .values({
          coachId: code.ownerCoachId,
          type: 'commission',
          amountMinor: commissionMinor,
          currency,
          sourceType: 'promo_redemption',
          sourceId: redemption.id,
          note: `${mode} purchase settlement`,
        })
        .onConflictDoNothing({ target: [walletLedger.sourceType, walletLedger.sourceId] });
    }
    return;
  }

  // source === 'referral': no ledger entry, just close out the referral(s).
  await db
    .update(referrals)
    .set({ status: 'rewarded', rewardedAt: new Date() })
    .where(
      and(
        eq(referrals.status, 'joined'),
        or(eq(referrals.referrerId, accountId), eq(referrals.inviteeId, accountId)),
      ),
    );
}

export interface CoachBalance {
  currency: string;
  amountMinor: number;
}

/**
 * One coach's wallet balance per currency — SUM(amountMinor) grouped by
 * currency (no materialized balance column, per the wallet_ledger schema
 * comment). Used by GET /api/coach/wallet (self-scoped).
 */
export async function coachWalletBalances(coachId: string): Promise<CoachBalance[]> {
  const db = getDb();
  const rows = await db
    .select({
      currency: walletLedger.currency,
      amountMinor: sql<number>`sum(${walletLedger.amountMinor})::int`,
    })
    .from(walletLedger)
    .where(eq(walletLedger.coachId, coachId))
    .groupBy(walletLedger.currency);
  return rows;
}

export interface AllCoachBalancesRow {
  coachId: string;
  currency: string;
  amountMinor: number;
}

/**
 * Every coach's wallet balance per currency in ONE grouped query (SCALE-UP-PLAN
 * §4.1: "balances via one grouped query (no N+1)"). GET /api/admin/wallets
 * joins this in-memory against the coach roster rather than querying per-coach.
 */
export async function allCoachWalletBalances(): Promise<AllCoachBalancesRow[]> {
  const db = getDb();
  return db
    .select({
      coachId: walletLedger.coachId,
      currency: walletLedger.currency,
      amountMinor: sql<number>`sum(${walletLedger.amountMinor})::int`,
    })
    .from(walletLedger)
    .groupBy(walletLedger.coachId, walletLedger.currency);
}

export interface RecordWalletEntryArgs {
  coachId: string;
  type: 'adjustment' | 'payout';
  amountMinor: number;
  currency: string;
  note?: string | null;
  createdBy: string;
}

export interface WalletEntry {
  id: string;
  type: 'commission' | 'adjustment' | 'payout';
  amountMinor: number;
  currency: string;
  note: string | null;
  createdAt: Date;
}

/**
 * Inserts one manual wallet_ledger row (admin adjustment or payout). Bounds
 * validation (payout must be negative, adjustment non-zero) is the caller's
 * job (POST /api/admin/wallets/[coachId]/entries, via zod) — this is a plain
 * insert, kept here only so the two wallet routes share one write path.
 */
export async function recordWalletEntry(args: RecordWalletEntryArgs): Promise<WalletEntry> {
  const db = getDb();
  const [row] = await db
    .insert(walletLedger)
    .values({
      coachId: args.coachId,
      type: args.type,
      amountMinor: args.amountMinor,
      currency: args.currency,
      note: args.note ?? null,
      createdBy: args.createdBy,
    })
    .returning({
      id: walletLedger.id,
      type: walletLedger.type,
      amountMinor: walletLedger.amountMinor,
      currency: walletLedger.currency,
      note: walletLedger.note,
      createdAt: walletLedger.createdAt,
    });
  if (!row) throw new Error('recordWalletEntry: insert returned no row');
  return row;
}
