import { discountGrants, promoCodes, promoRedemptions } from '@gym/db';
import { normalizePromoCode } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { grantDiscount } from '@/lib/promoEconomy';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * POST /api/promo/redeem {code} — member redeems a promo code
 * (SCALE-UP-PLAN §4.1 / §1.3). Rate-limited 10/hr/account.
 *
 * Validation order: code exists + active → not expired (window) → under
 * maxRedemptions → not the coach's own code → not already redeemed by this
 * account. Errors are one of exactly three uniform codes so the response
 * never becomes a code-ownership or code-existence oracle: `invalid_code`
 * (unknown, inactive, or the caller's own code), `expired` (past window or
 * exhausted), `already_used` (this account already redeemed it).
 *
 * Half-failed repair: an existing 'reserved' row with no discount_grants row
 * for this (account, code) means an earlier redeem inserted the reservation
 * but crashed before granting the discount — the retry repairs it by running
 * the same cap-guarded redemptionCount bump (the reservation is inserted
 * before that bump, so the row's existence does NOT prove it was counted) and
 * then inserting the missing grant. See the inline comment below.
 *
 * On success: inserts a 'reserved' promo_redemptions row (unique per
 * (codeId, accountId) — the real concurrency guard for a duplicate-redeem
 * race, TOCTOU-safe via onConflictDoNothing), then bumps redemptionCount with
 * a WHERE guard that re-checks maxRedemptions atomically (the real guard for
 * the cap — the pre-check above is only a fast-path; DIFFERENT accounts
 * racing past it would otherwise all pass), rolling back the redemption if
 * the cap won the race, and grants the discount via grantDiscount (best pct
 * wins over any older active grant). Returns {code, discountPct}.
 */

const bodySchema = z.object({
  code: z.string().min(1).max(32),
});

/**
 * Claims one redemption slot exactly once. The redemption row is locked first,
 * then its counted_at marker and the code counter change in the same statement.
 * A crash after this returns can safely retry without incrementing again.
 */
async function claimRedemptionCapacity(redemptionId: string, promoCodeId: string): Promise<boolean> {
  const result = await getDb().execute<{ id: string }>(sql`
    with eligible_redemption as materialized (
      select id
      from promo_redemptions
      where id = ${redemptionId}
        and counted_at is null
      for update
    ), bumped as (
      update promo_codes
      set redemption_count = redemption_count + 1
      where id = ${promoCodeId}
        and active = true
        and (expires_at is null or expires_at > now())
        and exists (select 1 from eligible_redemption)
        and (max_redemptions is null or redemption_count < max_redemptions)
      returning id
    )
    update promo_redemptions
    set counted_at = now()
    where id in (select id from eligible_redemption)
      and exists (select 1 from bumped)
    returning id
  `);
  return result.rows.length > 0;
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'promo/redeem',
    limit: 10,
    windowMs: 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const code = normalizePromoCode(parsed.data.code);
  if (!code) return json({ error: 'invalid_code' }, 400);

  const db = getDb();
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
  if (!promo || !promo.active) return json({ error: 'invalid_code' }, 400);

  const now = new Date();
  if (promo.expiresAt && promo.expiresAt.getTime() <= now.getTime()) {
    return json({ error: 'expired' }, 400);
  }
  if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) {
    return json({ error: 'expired' }, 400);
  }
  // A coach may never redeem their own code. Mapped to invalid_code (not a
  // distinct error) so the response never confirms code ownership.
  if (promo.ownerCoachId === me.id) return json({ error: 'invalid_code' }, 400);

  const existing = await db
    .select({
      id: promoRedemptions.id,
      status: promoRedemptions.status,
      countedAt: promoRedemptions.countedAt,
    })
    .from(promoRedemptions)
    .where(and(eq(promoRedemptions.codeId, promo.id), eq(promoRedemptions.accountId, me.id)))
    .limit(1);
  if (existing.length > 0) {
    const redemption = existing[0]!;
    // A previously-'applied' redemption (purchase already settled against it)
    // is unambiguously already used.
    if (redemption.status !== 'reserved') return json({ error: 'already_used' }, 400);

    // Half-failed repair (W6 sweep): 'reserved' is also the normal steady
    // state for a healthy redemption — settlePromoOnPurchase only flips it to
    // 'applied' once the member actually buys a paid tier. So 'reserved'
    // alone doesn't mean broken. What DOES mean broken: the reserved row was
    // inserted but grantDiscount() never ran/committed (e.g. the process died
    // between the steps) — in that case NO discount_grants row exists for this
    // (account, code) at all, regardless of status. If any such row exists
    // (active, expired-by-a-later-better-grant, or consumed), grantDiscount
    // already succeeded once and this is a genuine repeat redeem attempt.
    const [priorGrant] = await db
      .select({ id: discountGrants.id })
      .from(discountGrants)
      .where(and(eq(discountGrants.accountId, me.id), eq(discountGrants.promoCodeId, promo.id)))
      .limit(1);
    if (priorGrant) return json({ error: 'already_used' }, 400);

    // E4: the reserved row is inserted BEFORE redemptionCount is bumped (see
    // the fresh-redemption path below), so a crash between those two steps
    // leaves a 'reserved' row that was never counted. The repair must run the
    // SAME cap-guarded bump before granting — otherwise this delivered
    // discount is never charged against maxRedemptions and N+1 accounts can
    // obtain the discount. The WHERE re-checks the cap atomically; if the cap
    // has since filled, we do NOT grant (the discount can't exceed the cap).
    if (redemption.countedAt === null) {
      const claimed = await claimRedemptionCapacity(redemption.id, promo.id);
      if (!claimed) return json({ error: 'expired' }, 400);
    }

    await grantDiscount({
      accountId: me.id,
      source: 'promo',
      pct: promo.discountPct,
      promoCodeId: promo.id,
      expiresAt: null,
    });
    return json({ code: promo.code, discountPct: promo.discountPct }, 200);
  }

  // CONCURRENCY: the checks above are check-then-insert (TOCTOU) — two
  // concurrent redeems for the same (code, account) collide on the
  // promo_redemptions_code_account unique index; onConflictDoNothing maps the
  // loser to the same already_used response the pre-check uses.
  const inserted = await db
    .insert(promoRedemptions)
    .values({ codeId: promo.id, accountId: me.id, status: 'reserved' })
    .onConflictDoNothing({ target: [promoRedemptions.codeId, promoRedemptions.accountId] })
    .returning({ id: promoRedemptions.id });
  if (inserted.length === 0) return json({ error: 'already_used' }, 400);

  // CONCURRENCY: the maxRedemptions pre-check above is also check-then-act —
  // two different accounts can both pass it before either increments. The
  // WHERE guard here re-evaluates the cap against the row's CURRENT value at
  // UPDATE time (Postgres re-checks a single-row UPDATE's WHERE clause after
  // taking the row lock, so concurrent increments serialize instead of both
  // reading a stale count), so at most maxRedemptions increments ever
  // succeed. A caller that loses this race rolls back its just-inserted
  // redemption so the account isn't left holding a redemption for a code that
  // never actually granted a discount.
  const claimed = await claimRedemptionCapacity(inserted[0]!.id, promo.id);
  if (!claimed) {
    await db.delete(promoRedemptions).where(eq(promoRedemptions.id, inserted[0]!.id));
    return json({ error: 'expired' }, 400);
  }

  await grantDiscount({
    accountId: me.id,
    source: 'promo',
    pct: promo.discountPct,
    promoCodeId: promo.id,
    expiresAt: null,
  });

  return json({ code: promo.code, discountPct: promo.discountPct }, 201);
}
