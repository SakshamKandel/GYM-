import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Billing mode switch.
 *
 * - 'disabled' (default): paid self-serve activation is unavailable.
 * - 'preview' (explicit non-production opt-in): tiers are a free preview selection — the self-serve
 *   POST /api/subscription/tier grants whatever the signed-in user picks
 *   (audited, expiry-free). This is the pre-store-launch behavior.
 * - 'live': money is attached. Self-serve tier writes are LOCKED to 'starter'
 *   (downgrade/cancel only) and paid tiers flow exclusively through verified
 *   RevenueCat webhooks (/api/subscription/revenuecat), which carry the
 *   provider-verified entitlement + expiry.
 *
 * Set BILLING_MODE=live together with BOTH REVENUECAT_WEBHOOK_AUTH and
 * REVENUECAT_WEBHOOK_SIGNATURE_SECRET before shipping a build where tiers cost
 * real money (CLAUDE.md: never trust the client for paid entitlements).
 * Production never permits preview grants.
 *
 * Why the signature secret counts here: /api/subscription/revenuecat rejects
 * every event it cannot verify, so without that secret a 'live' deployment
 * takes real store payments and grants nothing. Reporting 'disabled' instead
 * keeps the contradiction visible (the paywall hides the purchase button, the
 * admin Configuration card and the boot log both say paid plans are off)
 * rather than surfacing it as a member who paid and got no membership.
 */
export type BillingMode = 'disabled' | 'preview' | 'live';

interface BillingEnvironment {
  BILLING_MODE?: string;
  NODE_ENV?: string;
  REVENUECAT_WEBHOOK_AUTH?: string;
  REVENUECAT_WEBHOOK_SIGNATURE_SECRET?: string;
}

/** Every variable 'live' mode needs before a store purchase can be honoured. */
export const LIVE_BILLING_VARS = [
  'REVENUECAT_WEBHOOK_AUTH',
  'REVENUECAT_WEBHOOK_SIGNATURE_SECRET',
] as const satisfies readonly (keyof BillingEnvironment)[];

/** Resolve billing configuration without ever defaulting to a free grant. */
export function billingMode(env: BillingEnvironment = process.env): BillingMode {
  if (env.BILLING_MODE === 'live') {
    return LIVE_BILLING_VARS.every((name) => env[name]?.trim()) ? 'live' : 'disabled';
  }
  if (env.BILLING_MODE === 'preview' && env.NODE_ENV !== 'production') {
    return 'preview';
  }
  return 'disabled';
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

interface RevenueCatSignatureOptions {
  secret?: string;
  nowMs?: number;
  toleranceMs?: number;
}

/**
 * Verifies RevenueCat's HMAC signature over `timestamp.rawBody`.
 *
 * Handed no secret this returns true, because it has nothing to compare
 * against. That is NOT permission to run live billing unsigned: callers on the
 * money path must reject a missing secret themselves before they get here, the
 * way /api/subscription/revenuecat does, and billingMode() refuses to report
 * 'live' until REVENUECAT_WEBHOOK_SIGNATURE_SECRET is set.
 */
export function verifyRevenueCatSignature(
  rawBody: string,
  header: string | null,
  options: RevenueCatSignatureOptions = {},
): boolean {
  const secret = options.secret ?? process.env.REVENUECAT_WEBHOOK_SIGNATURE_SECRET;
  if (!secret) return true;
  if (!header) return false;

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't' && timestamp === null) timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return false;

  const timestampMs = Number(timestamp) * 1_000;
  const nowMs = options.nowMs ?? Date.now();
  const toleranceMs = options.toleranceMs ?? 5 * 60 * 1_000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs - timestampMs) > toleranceMs) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();
  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const supplied = Buffer.from(signature, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
