import { accounts, discountGrants, paymentRequests, promoRedemptions, walletLedger } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';
import { clientIp } from '@/lib/rateLimit';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * Admin console — refund/revoke an already-APPROVED manual payment (P0-1).
 *
 *  POST {reason?} → CAS approved → 'refunded' with three reversals, ordered so
 *  a crash mid-flight leaves a state a retry can safely finish:
 *
 *   1. Wallet clawback: a NEGATIVE wallet_ledger 'adjustment' matching the
 *      commission this request credited, keyed (sourceType:'refund',
 *      sourceId:requestId) — idempotent via the wallet_ledger unique
 *      (sourceType, sourceId) index, so a double-refund never double-claws.
 *      Skipped when the request carried no commission (no promo).
 *   2. Promo reversal: un-burn the member's one-time discount — restore the
 *      consumed discount_grant to 'active' (only when no OTHER active grant
 *      exists, so the one-active partial unique index still holds) and roll the
 *      promo_redemption back to 'reserved', clearing the settled figures so the
 *      redemption ledger stays consistent with the wallet clawback above. Both
 *      writes are status-guarded → idempotent. Only when the request carried a
 *      promo grant at settlement.
 *   3. Tier rollback: if the granted tier is STILL what the member holds
 *      (account.tier === request.tier), RESTORE the member's pre-approval window
 *      (priorTier/priorExpiresAt snapshotted by the approve route) rather than
 *      collapsing to starter — so refunding a renewal/extension gives back the
 *      separately-paid time this payment merely pushed forward. A fresh grant on
 *      a starter member (or a legacy row with no snapshot) still collapses to
 *      permanent starter. If they've since moved to another tier we leave it — a
 *      later grant is not this payment's to revoke. Idempotent.
 *   4. Status flip LAST (CAS approved→refunded). The loser of a refund race, or
 *      a retry after the flip already landed, gets 409 already_refunded — the
 *      idempotent reversals above having run harmlessly at most once each.
 *
 *  Audited as 'payment.refund'.
 *
 * Guarded by requirePermission('payments.review'); super_admin/main_admin pass.
 */

const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'payments.review');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { reason } = parsed.data;

  const db = getDb();
  const ip = clientIp(req);

  const [row] = await db
    .select({
      id: paymentRequests.id,
      accountId: paymentRequests.accountId,
      tier: paymentRequests.tier,
      status: paymentRequests.status,
      priorTier: paymentRequests.priorTier,
      priorExpiresAt: paymentRequests.priorExpiresAt,
      priorTierSource: paymentRequests.priorTierSource,
      priorTierSourceId: paymentRequests.priorTierSourceId,
      discountGrantId: paymentRequests.discountGrantId,
      promoCodeId: paymentRequests.promoCodeId,
    })
    .from(paymentRequests)
    .where(eq(paymentRequests.id, id))
    .limit(1);
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.status === 'refunded') return json({ error: 'already_refunded' }, 409);
  if (row.status !== 'approved') return json({ error: 'not_approved' }, 409);

  // 1. Wallet clawback (idempotent via the unique (sourceType, sourceId) index).
  const [commission] = await db
    .select({
      coachId: walletLedger.coachId,
      amountMinor: walletLedger.amountMinor,
      currency: walletLedger.currency,
    })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.type, 'commission'),
        eq(walletLedger.sourceType, 'payment_request'),
        eq(walletLedger.sourceId, row.id),
      ),
    )
    .limit(1);
  if (commission && commission.amountMinor !== 0) {
    await db
      .insert(walletLedger)
      .values({
        coachId: commission.coachId,
        type: 'adjustment',
        amountMinor: -commission.amountMinor,
        currency: commission.currency,
        sourceType: 'refund',
        sourceId: row.id,
        note: `Refund of payment ${row.id}`,
        createdBy: principal.id,
      })
      .onConflictDoNothing({ target: [walletLedger.sourceType, walletLedger.sourceId] });
  }

  // 2. Promo reversal (P0-1) — un-burn the member's one-time discount and undo
  //    the redemption bookkeeping so it stays consistent with the wallet
  //    clawback above. Only when this request carried a promo/referral grant.
  if (row.discountGrantId) {
    // Restore the consumed grant to 'active' so bestActiveGrant surfaces it
    // again on a re-payment — but only when the account has no OTHER active
    // grant (the discount_grants_one_active partial unique index permits one).
    const [otherActive] = await db
      .select({ id: discountGrants.id })
      .from(discountGrants)
      .where(and(eq(discountGrants.accountId, row.accountId), eq(discountGrants.status, 'active')))
      .limit(1);
    if (!otherActive) {
      await db
        .update(discountGrants)
        .set({ status: 'active', consumedAt: null })
        .where(
          and(eq(discountGrants.id, row.discountGrantId), eq(discountGrants.status, 'consumed')),
        );
    }
    // Roll the promo redemption back to 'reserved' and clear the settled
    // figures — the commission they recorded was just clawed back; a later
    // re-payment re-runs the reserved→applied CAS cleanly. Referral grants have
    // no promo_redemptions row, so this only fires for promo-code grants.
    if (row.promoCodeId) {
      await db
        .update(promoRedemptions)
        .set({
          status: 'reserved',
          purchaseAmountMinor: null,
          currency: null,
          commissionMinor: null,
          appliedAt: null,
        })
        .where(
          and(
            eq(promoRedemptions.codeId, row.promoCodeId),
            eq(promoRedemptions.accountId, row.accountId),
            eq(promoRedemptions.status, 'applied'),
          ),
        );
    }
  }

  // 3. Tier rollback — only when the granted tier is still in force. Restore the
  //    member's PRE-APPROVAL window (B1) instead of collapsing to starter, so a
  //    refunded renewal/extension gives back the separately-paid time this
  //    payment did not itself grant.
  const [account] = await db
    .select({
      tier: accounts.tier,
      tierSource: accounts.tierSource,
      tierSourceId: accounts.tierSourceId,
    })
    .from(accounts)
    .where(eq(accounts.id, row.accountId))
    .limit(1);
  const ownsCurrentGrant =
    account?.tier === row.tier &&
    account.tierSource === 'manual_payment' &&
    account.tierSourceId === row.id;
  let tierRestored = false;
  if (ownsCurrentGrant) {
    if (row.priorTier != null && row.priorTier !== 'starter') {
      // Renewal/extension, or an overwrite of a higher/permanent tier: put the
      // exact pre-approval window back. A null priorExpiresAt means the prior
      // tier was permanent (e.g. a comp), so it restores as permanent.
      tierRestored = await setAccountTier(
        row.accountId,
        row.priorTier,
        principal,
        'payment_refund',
        { startsAt: new Date(), expiresAt: row.priorExpiresAt ?? null },
        row.priorTierSource,
        row.priorTierSourceId,
        undefined,
        { source: 'manual_payment', sourceId: row.id },
      );
    } else {
      // Fresh grant on a starter member (or legacy row with no snapshot):
      // collapse to permanent starter.
      tierRestored = await setAccountTier(
        row.accountId,
        'starter',
        principal,
        'payment_refund',
        { startsAt: new Date(), expiresAt: null },
        row.priorTierSource,
        row.priorTierSourceId,
        undefined,
        { source: 'manual_payment', sourceId: row.id },
      );
    }
  }

  // 4. Status flip LAST (CAS). Loser of a race / retry after flip → 409.
  const flipped = await db
    .update(paymentRequests)
    .set({ status: 'refunded', reviewNote: reason ?? null, decidedBy: principal.id, decidedAt: new Date() })
    .where(and(eq(paymentRequests.id, id), eq(paymentRequests.status, 'approved')))
    .returning({ id: paymentRequests.id });
  if (!flipped[0]) return json({ error: 'already_refunded' }, 409);

  await logAudit(principal, 'payment.refund', 'payment_request', row.id, {
    accountId: row.accountId,
    tier: row.tier,
    reason,
    clawbackMinor: commission ? -commission.amountMinor : 0,
    promoReversed: !!row.discountGrantId,
    restoredTier: tierRestored ? (row.priorTier ?? 'starter') : null,
  }, ip);

  after(() =>
    sendPushToAccount(row.accountId, {
      title: 'Payment refunded',
      body: 'Your recent payment was refunded and the tier removed.',
      data: { type: 'payment_decided' },
    }),
  );

  return json({ ok: true }, 200);
}
