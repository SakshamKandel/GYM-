import { accounts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { billingMode } from '@/lib/billing';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { resolveCatalogAmount, settlePromoOnPurchase } from '@/lib/promoEconomy';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * POST /api/subscription/tier — SELF-SERVE tier selection (Bearer).
 *
 * This is the ONLY way a member changes their own accounts.tier (the old
 * PUT /api/profile mirror is gone). It routes through setAccountTier(), so the
 * write is audited ('subscription.override', reason 'self_serve_paywall'),
 * mirrored onto the profile blob, and the Greece elite auto-assignment stays
 * in sync.
 *
 * Billing (lib/billing.ts): in 'preview' mode (default, no store accounts
 * yet) tiers are a free preview selection and this endpoint grants what the
 * user picks. In 'live' mode (BILLING_MODE=live) money is attached: this
 * endpoint only accepts 'starter' (downgrade/cancel) and returns 402
 * { error: 'billing_required' } for paid tiers — those are granted solely by
 * the verified RevenueCat webhook (/api/subscription/revenuecat). The mobile
 * paywall treats 402 as "route through the store purchase flow".
 *
 * Cancel / downgrade (tier:'starter') carries PERIOD-END semantics (Pack J):
 * a still-active paid tier with a real FUTURE tierExpiresAt keeps its access
 * until that date (effectiveTier collapses it then — no cron, no instant
 * revoke of a store entitlement); the row is left untouched and the period end
 * is reported as `effectiveAt`. Only a permanent (no-expiry) or already-lapsed
 * grant downgrades immediately (effectiveAt = now).
 *
 * Response: 200 { user, effectiveAt } — `user` is the exact same shape
 * GET /api/me returns (re-resolved through userForToken so the client sees the
 * post-write EFFECTIVE tier); `effectiveAt` is the ISO instant the change takes
 * effect (now for an upgrade/immediate downgrade, or the period end for a
 * cancel-at-period-end).
 */

const bodySchema = z.object({
  tier: z.enum(['starter', 'silver', 'gold', 'elite']),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'subscription/tier',
    limit: 5,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { tier } = parsed.data;

  // Live billing: paid tiers come only from verified store receipts (the
  // RevenueCat webhook). Self-serve keeps exactly one power — cancel.
  if (billingMode() === 'live' && tier !== 'starter') {
    return json({ error: 'billing_required' }, 402);
  }

  // Cancel / downgrade with PERIOD-END semantics (Pack J). A member cancelling a
  // still-active paid tier keeps access until it lapses — we never instantly
  // revoke a window they've already paid for. effectiveTier collapses the tier
  // at the auth choke point once tierExpiresAt passes, so a future expiry needs
  // NO write here. Only a permanent (no-expiry) or already-lapsed grant is
  // downgraded now.
  if (tier === 'starter') {
    const db = getDb();
    const now = new Date();
    const [acct] = await db
      .select({ tier: accounts.tier, tierExpiresAt: accounts.tierExpiresAt })
      .from(accounts)
      .where(eq(accounts.id, user.id))
      .limit(1);
    const currentEffective = acct ? effectiveTier(acct.tier, acct.tierExpiresAt, now) : 'starter';
    const futureExpiry =
      acct?.tierExpiresAt && acct.tierExpiresAt.getTime() > now.getTime()
        ? acct.tierExpiresAt
        : null;

    if (currentEffective !== 'starter' && futureExpiry) {
      // Access continues until the paid window ends — nothing to mutate.
      const kept = await userForToken(token);
      if (!kept) return json({ error: 'unauthorized' }, 401);
      return json({ user: kept, effectiveAt: futureExpiry.toISOString() }, 200);
    }

    // No future window to honor → downgrade takes effect immediately. Clearing
    // expiresAt matters: a stale past tierExpiresAt must not linger.
    await setAccountTier(
      user.id,
      'starter',
      { id: user.id },
      'self_serve_cancel',
      { startsAt: now, expiresAt: null },
      'preview',
    );
    const downgraded = await userForToken(token);
    if (!downgraded) return json({ error: 'unauthorized' }, 401);
    return json({ user: downgraded, effectiveAt: now.toISOString() }, 200);
  }

  // Paid self-serve selection (preview mode): starts now and carries NO expiry
  // (billing will own real windows). Clearing expiresAt matters: a stale past
  // tierExpiresAt (e.g. from a lapsed buddy trial) would otherwise collapse the
  // new tier to 'starter' at the auth choke point despite this successful write.
  const effectiveAt = new Date();
  await setAccountTier(
    user.id,
    tier,
    { id: user.id },
    'self_serve_paywall',
    { startsAt: effectiveAt, expiresAt: null },
    'preview',
  );

  // Promo/referral settlement (SCALE-UP-PLAN §4.1): this PAID-tier self-serve
  // pick (tier is narrowed to non-starter here — the starter branch returned
  // above) consumes the account's active discount grant and closes out any
  // referral. No real money moves in preview mode, so the catalog's base price
  // stands in for the sale amount — but settlePromoOnPurchase itself never
  // writes a real wallet_ledger commission credit for mode 'preview' (that
  // would be free, farmable payable balance). Best-effort — never fail an
  // already-successful tier grant for this.
  try {
    const { amountMinor, currency } = await resolveCatalogAmount(user.id, tier);
    await settlePromoOnPurchase({
      accountId: user.id,
      mode: 'preview',
      sourceType: 'subscription_tier',
      sourceId: user.id,
      amountMinor,
      currency,
    });
  } catch {
    // Best-effort — see comment above.
  }

  // Same serializer as GET /api/me: re-resolve the token so the response is
  // the post-write effective user. A paid pick takes effect immediately.
  const updated = await userForToken(token);
  if (!updated) return json({ error: 'unauthorized' }, 401);
  return json({ user: updated, effectiveAt: effectiveAt.toISOString() }, 200);
}
