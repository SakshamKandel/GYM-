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

/**
 * Expires every still-active discount grant issued by one promo code (E5).
 * Deactivating a code (promoCodes.active=false) does NOT retroactively touch
 * grants already handed out — those carry a null expiresAt and would otherwise
 * keep discounting purchases (and, for owner codes, keep paying commission)
 * indefinitely. The admin deactivate action calls this to flip the code's
 * outstanding 'active' grants to 'expired'. Returns the number expired so the
 * caller can record it in the audit meta. Settlement independently re-checks
 * promoCodes.active, so this is belt-and-suspenders for the discount side.
 */
export async function expireGrantsForCode(promoCodeId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(discountGrants)
    .set({ status: 'expired' })
    .where(and(eq(discountGrants.promoCodeId, promoCodeId), eq(discountGrants.status, 'active')))
    .returning({ id: discountGrants.id });
  return rows.length;
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
 *
 * E6 edge: when the account has ZERO active grants, two concurrent calls both
 * snapshot best_pct=-1, both `expired` CTEs match nothing, and both try to
 * insert 'active' — there is no row to lock, so serialization can't order
 * them. The `discount_grants_one_active` partial unique index catches the
 * loser with a 23505; we re-run, and the retry now sees the winner's active
 * grant as current_best and resolves deterministically (supersede or insert
 * as 'expired').
 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === '23505') return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('discount_grants_one_active');
}

export async function grantDiscount(args: GrantDiscountArgs): Promise<string> {
  const db = getDb();
  const accountId = args.accountId;
  const pct = args.pct;

  const runOnce = () =>
    db.execute<{ id: string }>(sql`
    with current_best as (
      select coalesce(max(pct), -1) as best_pct
      from discount_grants
      where account_id = ${accountId} and status = 'active'
        and (expires_at is null or expires_at > now())
    ),
    expired as (
      update discount_grants
      set status = 'expired'
      where account_id = ${accountId}
        and status = 'active'
        and (
          -- Always sweep time-expired 'active' grants: current_best ignores
          -- them (E1), but the partial unique index does NOT — leaving one
          -- 'active' would collide with the new row we insert below (23505),
          -- and nothing else on the redeem/referral paths sweeps them.
          (expires_at is not null and expires_at <= now())
          -- Supersede the account's live active grant(s) when the new grant
          -- is at least as good and therefore inserts as 'active'.
          or ${pct} >= (select best_pct from current_best)
        )
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

  const MAX_ATTEMPTS = 4;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await runOnce();
      const row = result.rows[0];
      if (!row) throw new Error('grantDiscount: insert returned no row');
      return row.id;
    } catch (err) {
      // Only a lost race on the one-active constraint is retryable; the retry
      // sees the winner's grant and inserts as 'active' (if better) or
      // 'expired' (if worse), so it converges within a couple of passes.
      if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error('grantDiscount: exhausted retries');
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
 * Settles a discount grant against a completed PAID-tier purchase
 * (SCALE-UP-PLAN §4.1 / §4.5). Takes a single args object: `grantId` pins the
 * exact snapshotted grant to settle (manual-payment path), else the account's
 * current best active grant is used. Callers: POST /api/subscription/tier
 * (mode 'preview', after a self-serve paid pick), the RevenueCat webhook (mode
 * 'live', after an entitlement grant), and POST /api/admin/payment-requests/[id]
 * approve (mode 'manual', with the snapshotted `grantId`). Starter picks never
 * settle — callers should not invoke this for them. `sourceType`/`sourceId` key
 * the commission wallet_ledger row's unique index for idempotency. Returns
 * `{ settled, commissionMinor? }`.
 *
 * `amountMinor` is the PRE-discount catalog/snapshot price. §1.3 defines
 * commission off the price actually PAID, so this function applies the grant's
 * own pct to `amountMinor` before computing commission — never the raw figure.
 *
 * - No grant found → `{ settled: false }`.
 * - Consumes the grant (status 'consumed') LAST, regardless of source.
 * - source 'promo': finds this account's promo_redemptions row for the grant's
 *   code, marks it 'applied' (reserved→applied CAS) with the discounted amount,
 *   computes commissionMinor = round(pricePaidMinor * commissionPct / 100)
 *   where pricePaidMinor = applyDiscount(amountMinor, grant.pct), and credits
 *   the code-owning coach's wallet — idempotent via the wallet_ledger unique
 *   (sourceType, sourceId) index, so a retried webhook / re-approval never
 *   double-credits. The ledger insert happens BEFORE the redemption CAS and
 *   grant consume (B6), and is re-attempted even when the redemption is already
 *   'applied'. Crediting is skipped when the code has no owner (house code),
 *   the commission is 0, mode is 'preview' (no real money moved), OR the code
 *   is no longer active (E5 — a deactivated/banned coach's already-issued grant
 *   must not keep earning); in those cases the redemption is still marked
 *   'applied' (bookkeeping/UI stay accurate) but NO wallet_ledger row lands.
 * - source 'referral': flips every 'joined' referral row where this account
 *   is EITHER the referrer or the invitee to 'rewarded' (a referral grant has
 *   no back-reference to a specific referral row, so this is a best-effort
 *   settle-on-first-purchase by either party — matches SCALE-UP-PLAN §7.2's
 *   "purchase consumes the grant, row flips 'rewarded'").
 */
export interface SettlePromoArgs {
  accountId: string;
  mode: SettleMode;
  /** Idempotency key pair for the commission wallet_ledger row (unique index). */
  sourceType: string;
  sourceId: string;
  /**
   * PRE-discount catalog price; commission is computed on the discounted
   * amount (applyDiscount(amountMinor, grant.pct)), never this raw figure.
   */
  amountMinor: number;
  currency: string;
  /** True when amountMinor already is the provider-reported amount paid. */
  amountIsFinal?: boolean;
  /**
   * Snapshotted grant to settle (SCALE-UP-PLAN §4.5 / B3). When provided,
   * settle EXACTLY this grant (pinned at submit time for a manual payment
   * request) instead of re-resolving the account's current best active grant —
   * so a later, higher redemption can't hijack the settlement or credit the
   * wrong coach after the price was already quoted. Omit to settle the live
   * best active grant (self-serve / webhook paths).
   */
  grantId?: string | null;
}

export interface SettleResult {
  settled: boolean;
  commissionMinor?: number;
}

/** Fetches one grant by id, scoped to the owning account (§4.5 snapshot path). */
async function grantById(accountId: string, grantId: string): Promise<ActiveGrant | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: discountGrants.id,
      source: discountGrants.source,
      promoCodeId: discountGrants.promoCodeId,
      pct: discountGrants.pct,
      expiresAt: discountGrants.expiresAt,
    })
    .from(discountGrants)
    .where(and(eq(discountGrants.id, grantId), eq(discountGrants.accountId, accountId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function settlePromoOnPurchase(args: SettlePromoArgs): Promise<SettleResult> {
  const { accountId, mode, sourceType, sourceId, amountMinor, currency } = args;
  const db = getDb();

  // §4.5: settle the pinned snapshot grant when the caller supplies one
  // (manual-payment approval), else the account's current best active grant.
  const grant = args.grantId
    ? await grantById(accountId, args.grantId)
    : await bestActiveGrant(accountId);
  if (!grant) return { settled: false };

  const consumeGrant = () =>
    db
      .update(discountGrants)
      .set({ status: 'consumed', consumedAt: new Date() })
      .where(eq(discountGrants.id, grant.id));

  if (grant.source === 'promo') {
    if (!grant.promoCodeId) {
      await consumeGrant();
      return { settled: true };
    }

    const [code] = await db
      .select({
        id: promoCodes.id,
        ownerCoachId: promoCodes.ownerCoachId,
        commissionPct: promoCodes.commissionPct,
        active: promoCodes.active,
      })
      .from(promoCodes)
      .where(eq(promoCodes.id, grant.promoCodeId))
      .limit(1);
    if (!code) {
      await consumeGrant();
      return { settled: true };
    }

    const [redemption] = await db
      .select({ id: promoRedemptions.id, status: promoRedemptions.status })
      .from(promoRedemptions)
      .where(and(eq(promoRedemptions.codeId, code.id), eq(promoRedemptions.accountId, accountId)))
      .limit(1);
    if (!redemption) {
      await consumeGrant();
      return { settled: true };
    }

    // Commission is computed on what was actually paid under this grant's
    // discount, not the undiscounted catalog figure (SCALE-UP-PLAN §1.3).
    const pricePaidMinor = args.amountIsFinal
      ? Math.max(0, Math.round(amountMinor))
      : applyDiscount(amountMinor, grant.pct);
    const commissionMinor = Math.round((pricePaidMinor * code.commissionPct) / 100);

    // Credit the code-owning coach only when real money actually moved.
    // Skipped for: preview mode (no sale), house codes (no owner), zero
    // commission, AND a deactivated code (E5 — a banned/deactivated coach must
    // not keep earning commission on grants issued before the ban; settlement
    // re-checks promoCodes.active here since deactivation never touches issued
    // discount_grants rows).
    const shouldCredit =
      !!code.ownerCoachId && commissionMinor > 0 && mode !== 'preview' && code.active;

    // Ordering (B6 / §4.5): idempotent wallet_ledger insert FIRST (unique
    // (sourceType, sourceId)), redemption reserved→applied CAS as the pivot,
    // grant consume LAST — a crash mid-settle leaves a state a retry can
    // finish, never a double-credit. The ledger insert is re-attempted even
    // when the redemption is already 'applied' (a prior attempt may have died
    // between the two writes).
    if (shouldCredit && code.ownerCoachId) {
      await db
        .insert(walletLedger)
        .values({
          coachId: code.ownerCoachId,
          type: 'commission',
          amountMinor: commissionMinor,
          currency,
          sourceType,
          sourceId,
          note: `${mode} purchase settlement`,
        })
        .onConflictDoNothing({ target: [walletLedger.sourceType, walletLedger.sourceId] });
    }

    if (redemption.status !== 'applied') {
      await db
        .update(promoRedemptions)
        .set({
          status: 'applied',
          purchaseAmountMinor: pricePaidMinor,
          currency,
          commissionMinor,
          appliedAt: new Date(),
        })
        .where(
          and(eq(promoRedemptions.id, redemption.id), eq(promoRedemptions.status, 'reserved')),
        );
    }

    await consumeGrant();
    return { settled: true, commissionMinor: shouldCredit ? commissionMinor : undefined };
  }

  // source === 'referral': no ledger entry, just close out the referral(s).
  await consumeGrant();
  await db
    .update(referrals)
    .set({ status: 'rewarded', rewardedAt: new Date() })
    .where(
      and(
        eq(referrals.status, 'joined'),
        or(eq(referrals.referrerId, accountId), eq(referrals.inviteeId, accountId)),
      ),
    );
  return { settled: true };
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
  // sum(int) is a bigint — cast to text and Number() it (E12): a lifetime
  // ledger past ~2.147B minor units overflows a ::int cast and 500s the query.
  const rows = await db
    .select({
      currency: walletLedger.currency,
      amountMinor: sql<string>`sum(${walletLedger.amountMinor})::text`,
    })
    .from(walletLedger)
    .where(eq(walletLedger.coachId, coachId))
    .groupBy(walletLedger.currency);
  return rows.map((r) => ({ currency: r.currency, amountMinor: Number(r.amountMinor) }));
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
  // sum(int) → bigint cast to text + Number() (E12), same overflow guard as
  // coachWalletBalances.
  const rows = await db
    .select({
      coachId: walletLedger.coachId,
      currency: walletLedger.currency,
      amountMinor: sql<string>`sum(${walletLedger.amountMinor})::text`,
    })
    .from(walletLedger)
    .groupBy(walletLedger.coachId, walletLedger.currency);
  return rows.map((r) => ({
    coachId: r.coachId,
    currency: r.currency,
    amountMinor: Number(r.amountMinor),
  }));
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
