import { paymentRequests } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';
import { resolveCatalogAmount, settlePromoOnPurchase } from '@/lib/promoEconomy';
import { clientIp } from '@/lib/rateLimit';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * Admin console — decide one Nepal manual-payment request (SCALE-UP-PLAN
 * §1.5 / §4.1).
 *
 *  - POST {action:'approve'|'reject', note?} → the status flip is a single
 *    CAS UPDATE gated on `status='pending'` (mirrors the coach-requests
 *    cancel pattern), so a double-decide race (two admins, or a retried
 *    request) uniformly 404s the loser instead of double-applying the tier
 *    grant or double-settling commission.
 *
 *    approve: dated `setAccountTier` for exactly `months * 30 days` starting
 *    now (reason 'payment_request'), THEN `settlePromoOnPurchase` with the
 *    BASE (undiscounted) catalog amount for `months` — NOT the discounted
 *    amount the member actually paid (`paymentRequests.amountMinor`).
 *    settlePromoOnPurchase applies the account's own LIVE active grant pct to
 *    that base figure itself (its own doc comment), so passing the
 *    already-discounted stored amount here would double-apply the discount.
 *    reject: just records reviewNote.
 *
 *    Both branches push `payment_decided` to the member (SCALE-UP-PLAN §6.9)
 *    — pushRefresh.ts maps it to an immediate auth refresh so an approved
 *    tier clears the paywall without waiting on the debounced foreground
 *    catch-up.
 *
 * Guarded by requirePermission('payments.review'); super_admin/main_admin pass.
 */

const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
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
  const { action, note } = parsed.data;

  const db = getDb();
  const ip = clientIp(req);

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const updated = await db
    .update(paymentRequests)
    .set({
      status: newStatus,
      reviewNote: note ?? null,
      decidedBy: principal.id,
      decidedAt: new Date(),
    })
    .where(and(eq(paymentRequests.id, id), eq(paymentRequests.status, 'pending')))
    .returning({
      id: paymentRequests.id,
      accountId: paymentRequests.accountId,
      tier: paymentRequests.tier,
      months: paymentRequests.months,
      region: paymentRequests.region,
    });

  const request = updated[0];
  if (!request) return json({ error: 'not_found' }, 404);

  if (action === 'approve') {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + request.months * 30 * 24 * 60 * 60 * 1000);

    await setAccountTier(request.accountId, request.tier, principal, 'payment_request', {
      startsAt: now,
      expiresAt,
    });

    // BASE catalog amount (undiscounted) for the window, in the SAME region the
    // request was priced under — see doc comment above for why this must be the
    // base figure, not the row's already-discounted amountMinor.
    const { amountMinor: monthlyBase, currency } = await resolveCatalogAmount(
      request.accountId,
      request.tier,
      request.region,
    );
    await settlePromoOnPurchase(
      request.accountId,
      request.tier,
      monthlyBase * request.months,
      currency,
      'manual',
    );
  }

  await logAudit(
    principal,
    action === 'approve' ? 'payment.approve' : 'payment.reject',
    'payment_request',
    request.id,
    { accountId: request.accountId, tier: request.tier, months: request.months, note },
    ip,
  );

  // Push the decision (SCALE-UP-PLAN §6.9) — without this the member's
  // paywall only catches up on the next debounced foreground refresh, up to
  // 30s later. pushRefresh.ts maps 'payment_decided' to an immediate
  // useAuth.refresh() so the granted tier shows right away.
  after(() =>
    sendPushToAccount(request.accountId, {
      title: action === 'approve' ? 'Payment approved' : 'Payment update',
      body:
        action === 'approve'
          ? `Your ${request.tier} payment was approved — enjoy!`
          : 'Your payment request was not approved this time.',
      data: { type: 'payment_decided' },
    }),
  );

  return json({ ok: true }, 200);
}
