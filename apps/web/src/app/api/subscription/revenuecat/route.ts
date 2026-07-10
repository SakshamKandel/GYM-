import { accounts } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { verifyRevenueCatAuth } from '@/lib/billing';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http';
import { setAccountTier, type Tier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * POST /api/subscription/revenuecat — RevenueCat server-to-server webhook.
 *
 * This is the ONLY path that grants PAID tiers once BILLING_MODE=live: the
 * client never asserts its own entitlement, RevenueCat does. Configure the
 * webhook in the RevenueCat dashboard with an Authorization header equal to
 * REVENUECAT_WEBHOOK_AUTH, and set each app's appUserID to the account id at
 * login (Purchases.logIn(account.id)) so app_user_id resolves here.
 *
 * Tier mapping: RevenueCat entitlement identifiers are expected to be named
 * exactly 'silver' | 'gold' | 'elite'. The highest active entitlement wins.
 * Events that end access (EXPIRATION) or report no entitlements collapse the
 * account to 'starter' via the entitlement-free branch.
 *
 * Every write goes through setAccountTier → audited as 'subscription.override'
 * with reason 'revenuecat_webhook', profile mirror + Greece elite assignment
 * stay in sync, and expiry lands in accounts.tierExpiresAt where effectiveTier
 * enforces it at the auth choke point with no cron.
 *
 * Responses: RevenueCat retries non-2xx. Unknown users return 200 (retrying
 * won't create the account); malformed bodies return 400; bad auth 401.
 */

const PAID_TIERS = ['elite', 'gold', 'silver'] as const satisfies readonly Tier[];

const eventSchema = z.object({
  event: z.object({
    type: z.string(),
    app_user_id: z.string().min(1),
    entitlement_ids: z.array(z.string()).nullish(),
    purchased_at_ms: z.number().nullish(),
    expiration_at_ms: z.number().nullish(),
  }),
});

/** Event types that change what the user is entitled to. Everything else
 * (TEST, TRANSFER handled via app_user_id, BILLING_ISSUE grace…) is a no-op
 * acknowledged with 200 so RevenueCat stops retrying. */
const ENTITLEMENT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'CANCELLATION',
  'EXPIRATION',
  'SUBSCRIPTION_EXTENDED',
]);

export async function POST(req: Request) {
  if (!verifyRevenueCatAuth(req.headers.get('authorization'))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid' }, 400);
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const event = parsed.data.event;

  if (!ENTITLEMENT_EVENTS.has(event.type)) return json({ ok: true, skipped: event.type }, 200);

  const db = getDb();
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, event.app_user_id));
  // Unknown app_user_id: acknowledge — a retry can never succeed. (Covers
  // anonymous RevenueCat ids from before Purchases.logIn wiring.)
  if (!account) return json({ ok: true, skipped: 'unknown_user' }, 200);

  // Highest active entitlement wins; none → starter (expiry/cancel collapse).
  const entitlements = new Set(event.entitlement_ids ?? []);
  const tier: Tier =
    event.type === 'EXPIRATION'
      ? 'starter'
      : (PAID_TIERS.find((t) => entitlements.has(t)) ?? 'starter');

  const startsAt = event.purchased_at_ms != null ? new Date(event.purchased_at_ms) : undefined;
  const expiresAt =
    tier === 'starter'
      ? null // starter never expires
      : event.expiration_at_ms != null
        ? new Date(event.expiration_at_ms)
        : null;

  await setAccountTier(account.id, tier, { id: account.id }, 'revenuecat_webhook', {
    startsAt,
    expiresAt,
  });

  return json({ ok: true, tier }, 200);
}
