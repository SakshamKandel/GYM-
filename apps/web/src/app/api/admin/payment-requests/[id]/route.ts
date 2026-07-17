import { accounts, paymentRequests } from '@gym/db';
import {
  addCalendarMonths as sharedAddCalendarMonths,
  effectiveTier,
  planPaidTierWindow,
  type Tier,
} from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';
import { settlePromoOnPurchase } from '@/lib/promoEconomy';
import { clientIp } from '@/lib/rateLimit';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * Admin console — decide one Nepal manual-payment request (SCALE-UP-PLAN
 * §1.5 / §4.1).
 *
 *  POST {action:'approve'|'reject', note?, confirm?}
 *
 *  reject: a single CAS UPDATE gated on status='pending' flips to 'rejected'
 *    (records reviewNote). The reserved discount grant frees automatically — the
 *    submit-time reservation only counts pending rows.
 *
 *  approve: computes the tier window against the member's CURRENT tier before
 *    granting (B1 — extend vs overwrite, never blindly clobber remaining paid
 *    days):
 *      - same tier still active with a finite expiry → EXTEND from that expiry.
 *      - same tier permanent, or a HIGHER active tier → the approval would
 *        SHORTEN/DOWNGRADE, so it returns 409 { error:'confirm_required',
 *        preview } and applies nothing until the admin re-POSTs with
 *        confirm:true (P0-2).
 *      - otherwise (lower/expired/starter) → OVERWRITE from now.
 *    Windows use CALENDAR-month arithmetic with day-clamp (B9 — 12mo is a year,
 *    not 360 days).
 *
 *    The handler is idempotently re-runnable for an already-'approved' row (B2):
 *    tier_granted_at / settled_at are stamped as each side effect lands, so a
 *    retry after a partial failure completes only the missing steps instead of
 *    double-granting or double-crediting, and never 404s the caller. Settlement
 *    (B3) targets the SNAPSHOTTED grant (discountGrantId) against the frozen
 *    baseAmountMinor — never a re-resolved live grant or current catalog price.
 *
 *    Both branches push 'payment_decided' to the member (SCALE-UP-PLAN §6.9);
 *    pushRefresh.ts maps it to an immediate auth refresh.
 *
 * Guarded by requirePermission('payments.review'); super_admin/main_admin pass.
 */

const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
  // Explicit acknowledgement that an approval which would shorten a permanent
  // tier or downgrade a higher active tier should proceed anyway (P0-2 / B1).
  confirm: z.boolean().optional(),
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
  const { action, note, confirm } = parsed.data;

  const db = getDb();
  const ip = clientIp(req);

  // Load the full row up front — approval needs the settlement snapshot and the
  // idempotency stamps, and both branches need the current status.
  const [row] = await db
    .select({
      id: paymentRequests.id,
      accountId: paymentRequests.accountId,
      tier: paymentRequests.tier,
      months: paymentRequests.months,
      currency: paymentRequests.currency,
      status: paymentRequests.status,
      discountGrantId: paymentRequests.discountGrantId,
      baseAmountMinor: paymentRequests.baseAmountMinor,
      tierGrantedAt: paymentRequests.tierGrantedAt,
      settledAt: paymentRequests.settledAt,
      decidedAt: paymentRequests.decidedAt,
      priorTier: paymentRequests.priorTier,
      priorExpiresAt: paymentRequests.priorExpiresAt,
      priorTierSource: paymentRequests.priorTierSource,
      priorTierSourceId: paymentRequests.priorTierSourceId,
    })
    .from(paymentRequests)
    .where(eq(paymentRequests.id, id))
    .limit(1);
  if (!row) return json({ error: 'not_found' }, 404);

  // ---- reject ----
  if (action === 'reject') {
    if (row.status !== 'pending') return json({ error: 'already_decided' }, 409);
    const rejected = await db
      .update(paymentRequests)
      .set({ status: 'rejected', reviewNote: note ?? null, decidedBy: principal.id, decidedAt: new Date() })
      .where(and(eq(paymentRequests.id, id), eq(paymentRequests.status, 'pending')))
      .returning({ id: paymentRequests.id });
    if (!rejected[0]) return json({ error: 'already_decided' }, 409);

    await logAudit(principal, 'payment.reject', 'payment_request', row.id, {
      accountId: row.accountId,
      tier: row.tier,
      months: row.months,
      note,
    }, ip);
    after(() =>
      sendPushToAccount(row.accountId, {
        title: 'Payment update',
        body: 'Your payment request was not approved this time.',
        data: { type: 'payment_decided' },
      }),
    );
    return json({ ok: true }, 200);
  }

  // ---- approve ----
  // A rejected/refunded row can never be approved.
  if (row.status === 'rejected' || row.status === 'refunded') {
    return json({ error: 'already_decided' }, 409);
  }

  // Read the member's CURRENT tier to plan the window (B1). Load fresh — the
  // account may have changed tier since submission.
  const [account] = await db
    .select({
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      tierSource: accounts.tierSource,
      tierSourceId: accounts.tierSourceId,
    })
    .from(accounts)
    .where(eq(accounts.id, row.accountId))
    .limit(1);
  if (!account) return json({ error: 'account_not_found' }, 404);

  const now = new Date();
  const plan = planPaidTierWindow(
    account.tier as Tier,
    account.tierExpiresAt ?? null,
    row.tier as Tier,
    row.months,
    now,
  );

  // Confirm gate (P0-2): only meaningful for a still-pending row (a re-run of an
  // already-granted approval must not re-prompt). Shorten/downgrade needs an
  // explicit confirm:true.
  if (row.status === 'pending' && plan.needsConfirm && !confirm) {
    return json(
      {
        error: 'confirm_required',
        preview: {
          reason: plan.confirmReason,
          action: plan.action,
          currentTier: effectiveTier(account.tier as Tier, account.tierExpiresAt ?? null, now),
          currentExpiresAt: account.tierExpiresAt ? account.tierExpiresAt.toISOString() : null,
          resultTier: row.tier,
          resultExpiresAt: plan.expiresAt.toISOString(),
        },
      },
      409,
    );
  }

  // Flip pending → approved (CAS). If the row is ALREADY 'approved' we skip the
  // flip and just complete any missing side effects (B2 idempotent re-run).
  let flipped = false;
  let effectiveStatus = row.status;
  if (row.status === 'pending') {
    const upd = await db
      .update(paymentRequests)
      .set({
        status: 'approved',
        reviewNote: note ?? null,
        decidedBy: principal.id,
        decidedAt: new Date(),
        // Freeze the PRE-grant window (B1/B2 + P0-1): the grant below re-derives
        // from this on any retry, and refund restores it. Captured here, before
        // setAccountTier mutates the live account.
        priorTier: account.tier as Tier,
        priorExpiresAt: account.tierExpiresAt ?? null,
        priorTierSource: account.tierSource,
        priorTierSourceId: account.tierSourceId,
      })
      .where(and(eq(paymentRequests.id, id), eq(paymentRequests.status, 'pending')))
      .returning({ id: paymentRequests.id });
    if (upd[0]) {
      flipped = true;
      effectiveStatus = 'approved';
    } else {
      // Lost the race. Re-read: another admin may have approved (continue the
      // idempotent completion) or rejected (bail).
      const [after2] = await db
        .select({
          status: paymentRequests.status,
          tierGrantedAt: paymentRequests.tierGrantedAt,
          settledAt: paymentRequests.settledAt,
          decidedAt: paymentRequests.decidedAt,
          priorTier: paymentRequests.priorTier,
          priorExpiresAt: paymentRequests.priorExpiresAt,
          priorTierSource: paymentRequests.priorTierSource,
          priorTierSourceId: paymentRequests.priorTierSourceId,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, id))
        .limit(1);
      if (!after2 || after2.status !== 'approved') return json({ error: 'already_decided' }, 409);
      effectiveStatus = 'approved';
      row.tierGrantedAt = after2.tierGrantedAt;
      row.settledAt = after2.settledAt;
      row.decidedAt = after2.decidedAt;
      row.priorTier = after2.priorTier;
      row.priorExpiresAt = after2.priorExpiresAt;
      row.priorTierSource = after2.priorTierSource;
      row.priorTierSourceId = after2.priorTierSourceId;
    }
  }

  if (effectiveStatus !== 'approved') return json({ error: 'already_decided' }, 409);

  // Idempotent side effect 1: grant the tier window. Stamp tier_granted_at only
  // after the write so a retry re-runs it if it hadn't landed.
  //
  // The window MUST be reproducible across retries (B2). On a FRESH approval
  // (`flipped`) the account is still in its pre-grant state, so the full B1
  // extend/overwrite `plan` is correct. On an idempotent RE-RUN of a row that was
  // ALREADY 'approved' on entry, the account may already reflect a prior grant
  // whose stamp failed; recomputing `plan` from that mutated LIVE state would flip
  // a one-time grant into an EXTEND (and, for a same-tier renewal that first
  // computed an extend, an overwrite would DESTROY the longer window) — either way
  // mis-granting paid time. So the re-run re-derives the window from the FROZEN
  // pre-approval snapshot (priorTier/priorExpiresAt captured at the flip): the B1
  // math is identical to the fresh attempt because its inputs are identical, and
  // setAccountTier applies expiresAt as an absolute SET, so every retry converges
  // to the same window. Legacy rows approved before the snapshot columns existed
  // fall back to a deterministic OVERWRITE anchored to the persisted decidedAt.
  if (!row.tierGrantedAt) {
    let grantWindow: { startsAt: Date | undefined; expiresAt: Date };
    if (flipped) {
      grantWindow = { startsAt: plan.startsAt, expiresAt: plan.expiresAt };
    } else if (row.priorTier != null) {
      const rerunPlan = planPaidTierWindow(
        row.priorTier as Tier,
        row.priorExpiresAt ?? null,
        row.tier as Tier,
        row.months,
        now,
      );
      grantWindow = { startsAt: rerunPlan.startsAt, expiresAt: rerunPlan.expiresAt };
    } else {
      const anchor = row.decidedAt ?? now;
      grantWindow = {
        startsAt: anchor,
        expiresAt: sharedAddCalendarMonths(anchor, row.months),
      };
    }
    await setAccountTier(
      row.accountId,
      row.tier as Tier,
      principal,
      'payment_request',
      grantWindow,
      'manual_payment',
      row.id,
    );
    await db
      .update(paymentRequests)
      .set({ tierGrantedAt: new Date() })
      .where(eq(paymentRequests.id, id));
  }

  // Idempotent side effect 2: settle the SNAPSHOTTED promo grant (B3). Only
  // runs when the request actually carried a discount at submit; the wallet
  // credit is deduped by (sourceType, sourceId) inside settlePromoOnPurchase.
  // On settle failure we leave settled_at null so a re-decide re-attempts it.
  if (!row.settledAt) {
    let settleOk = true;
    if (row.discountGrantId && row.baseAmountMinor != null) {
      try {
        await settlePromoOnPurchase({
          accountId: row.accountId,
          mode: 'manual',
          sourceType: 'payment_request',
          sourceId: row.id,
          amountMinor: row.baseAmountMinor,
          currency: row.currency,
          grantId: row.discountGrantId,
        });
      } catch (err) {
        console.error(`payment settle failed for request "${row.id}":`, err);
        settleOk = false;
      }
    }
    if (settleOk) {
      await db
        .update(paymentRequests)
        .set({ settledAt: new Date() })
        .where(eq(paymentRequests.id, id));
    }
  }

  // Audit + push only on a FRESH decision — an idempotent completion re-run
  // must not duplicate the audit row or re-notify the member.
  if (flipped) {
    await logAudit(principal, 'payment.approve', 'payment_request', row.id, {
      accountId: row.accountId,
      tier: row.tier,
      months: row.months,
      window: plan.action,
      expiresAt: plan.expiresAt.toISOString(),
      note,
    }, ip);
    after(() =>
      sendPushToAccount(row.accountId, {
        title: 'Payment approved',
        body: `Your ${row.tier} payment was approved — enjoy!`,
        data: { type: 'payment_decided' },
      }),
    );
  }

  return json({ ok: true }, 200);
}
