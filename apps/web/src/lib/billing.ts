import { timingSafeEqual } from 'node:crypto';

/**
 * Billing mode switch.
 *
 * - 'preview' (default): tiers are a free preview selection — the self-serve
 *   POST /api/subscription/tier grants whatever the signed-in user picks
 *   (audited, expiry-free). This is the pre-store-launch behavior.
 * - 'live': money is attached. Self-serve tier writes are LOCKED to 'starter'
 *   (downgrade/cancel only) and paid tiers flow exclusively through verified
 *   RevenueCat webhooks (/api/subscription/revenuecat), which carry the
 *   provider-verified entitlement + expiry.
 *
 * Set BILLING_MODE=live together with REVENUECAT_WEBHOOK_AUTH before shipping
 * a build where tiers cost real money (CLAUDE.md: never trust the client for
 * paid entitlements).
 */
export function billingMode(): 'preview' | 'live' {
  return process.env.BILLING_MODE === 'live' ? 'live' : 'preview';
}

/**
 * Constant-time check of the RevenueCat webhook Authorization header value
 * against REVENUECAT_WEBHOOK_AUTH. Returns false when the secret is unset —
 * an unconfigured endpoint must reject everything, not accept everything.
 */
export function verifyRevenueCatAuth(header: string | null): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
