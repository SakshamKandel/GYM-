import { accounts, revenuecatEvents } from '@gym/db';
import { compareTiers, effectiveTier } from '@gym/shared';
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { verifyRevenueCatAuth, verifyRevenueCatSignature } from '@/lib/billing';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http';
import { resolveCatalogAmount, settlePromoOnPurchase } from '@/lib/promoEconomy';
import { setAccountTier, type Tier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * RevenueCat server-to-server entitlement handler. Authorization is always
 * required; HMAC verification is additionally enforced when its secret is
 * configured. Event ids dedupe every entitlement event, while event timestamps
 * prevent delayed delivery from replacing newer subscription state.
 */

const PAID_TIERS = ['elite', 'gold', 'silver'] as const satisfies readonly Tier[];

const eventSchema = z.object({
  event: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    event_timestamp_ms: z.number().int().nonnegative(),
    app_user_id: z.string().min(1),
    original_app_user_id: z.string().min(1).nullish(),
    aliases: z.array(z.string().min(1)).nullish(),
    entitlement_ids: z.array(z.string()).nullable().optional(),
    purchased_at_ms: z.number().int().nonnegative().nullish(),
    expiration_at_ms: z.number().int().nonnegative().nullish(),
    currency: z.string().length(3).transform((value) => value.toUpperCase()).nullish(),
    price_in_purchased_currency: z.number().finite().nonnegative().nullish(),
  }),
});

const ENTITLEMENT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'CANCELLATION',
  'EXPIRATION',
  'SUBSCRIPTION_EXTENDED',
]);

// A free initial trial carries no money. Its first positive RENEWAL is the
// purchase that consumes a pending promo/referral grant.
const SETTLEMENT_EVENTS = new Set(['INITIAL_PURCHASE', 'RENEWAL']);
const PROTECTED_SOURCES = new Set(['manual_payment', 'console', 'coach']);

export async function POST(req: Request) {
  if (!verifyRevenueCatAuth(req.headers.get('authorization'))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json({ error: 'invalid' }, 400);
  }
  if (!verifyRevenueCatSignature(rawBody, req.headers.get('x-revenuecat-webhook-signature'))) {
    return json({ error: 'invalid_signature' }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return json({ error: 'invalid' }, 400);
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const event = parsed.data.event;

  if (!ENTITLEMENT_EVENTS.has(event.type)) {
    return json({ ok: true, skipped: event.type }, 200);
  }

  const db = getDb();
  const [knownEvent] = await db
    .select({
      processedAt: revenuecatEvents.processedAt,
      tierAppliedAt: revenuecatEvents.tierAppliedAt,
    })
    .from(revenuecatEvents)
    .where(eq(revenuecatEvents.eventId, event.id))
    .limit(1);
  if (knownEvent?.processedAt) return json({ ok: true, skipped: 'duplicate' }, 200);

  // RevenueCat recommends checking all subscriber aliases because transfers
  // and identity merges can change the last-seen app_user_id.
  const identifiers = Array.from(
    new Set(
      [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    ),
  );
  const [account] = await db
    .select({
      id: accounts.id,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      tierSource: accounts.tierSource,
      tierSourceId: accounts.tierSourceId,
      revenuecatEventAt: accounts.revenuecatEventAt,
    })
    .from(accounts)
    .where(inArray(accounts.id, identifiers))
    .limit(1);

  const eventAt = new Date(event.event_timestamp_ms);
  await db
    .insert(revenuecatEvents)
    .values({
      eventId: event.id,
      accountId: account?.id ?? null,
      type: event.type,
      eventAt,
      processedAt: account ? null : new Date(),
      tierAppliedAt: account ? null : new Date(),
    })
    .onConflictDoNothing({ target: revenuecatEvents.eventId });

  const [eventState] = await db
    .select({
      processedAt: revenuecatEvents.processedAt,
      tierAppliedAt: revenuecatEvents.tierAppliedAt,
    })
    .from(revenuecatEvents)
    .where(eq(revenuecatEvents.eventId, event.id))
    .limit(1);
  if (eventState?.processedAt) {
    return json({ ok: true, skipped: account ? 'duplicate' : 'unknown_user' }, 200);
  }
  if (!account || !eventState) return json({ ok: true, skipped: 'unknown_user' }, 200);

  const entitlements = new Set(event.entitlement_ids ?? []);
  const tier: Tier = PAID_TIERS.find((candidate) => entitlements.has(candidate)) ?? 'starter';
  const startsAt = event.purchased_at_ms != null ? new Date(event.purchased_at_ms) : undefined;
  const expiresAt =
    tier === 'starter'
      ? null
      : event.expiration_at_ms != null
        ? new Date(event.expiration_at_ms)
        : null;

  let tierApplied = eventState.tierAppliedAt !== null;
  let tierSkipReason: 'protected_grant' | 'stale_event' | null = null;
  if (!tierApplied) {
    const now = new Date();
    const currentEffective = effectiveTier(
      account.tier as Tier,
      account.tierExpiresAt ?? null,
      now,
    );
    const comparison = compareTiers(tier, currentEffective);
    const currentExpiryMs =
      account.tierExpiresAt == null ? Number.POSITIVE_INFINITY : account.tierExpiresAt.getTime();
    const incomingExpiryMs = expiresAt == null ? Number.POSITIVE_INFINITY : expiresAt.getTime();
    const protectedGrant =
      account.tierSource != null &&
      PROTECTED_SOURCES.has(account.tierSource) &&
      currentExpiryMs > now.getTime() &&
      (comparison < 0 || (comparison === 0 && incomingExpiryMs < currentExpiryMs));

    if (protectedGrant) {
      tierSkipReason = 'protected_grant';
      await db
        .update(accounts)
        .set({ revenuecatEventAt: eventAt })
        .where(
          and(
            eq(accounts.id, account.id),
            or(isNull(accounts.revenuecatEventAt), lt(accounts.revenuecatEventAt, eventAt)),
          ),
        );
    } else {
      tierApplied = await setAccountTier(
        account.id,
        tier,
        { id: account.id },
        'revenuecat_webhook',
        { startsAt, expiresAt },
        'revenuecat',
        event.id,
        eventAt,
      );
      if (!tierApplied) tierSkipReason = 'stale_event';
    }

    await db
      .update(revenuecatEvents)
      .set({ tierAppliedAt: new Date() })
      .where(eq(revenuecatEvents.eventId, event.id));
  }

  if (tier !== 'starter' && SETTLEMENT_EVENTS.has(event.type)) {
    try {
      let amountMinor: number;
      let currency: string;
      let amountIsFinal = false;
      if (
        event.price_in_purchased_currency != null &&
        event.currency != null
      ) {
        amountMinor = Math.round(event.price_in_purchased_currency * 100);
        currency = event.currency;
        amountIsFinal = true;
      } else {
        const catalog = await resolveCatalogAmount(account.id, tier);
        amountMinor = catalog.amountMinor;
        currency = catalog.currency;
      }

      // Zero means a free trial or complimentary transaction. Keep the grant
      // active for the first positive renewal instead of paying commission on
      // catalog money that never moved.
      if (amountMinor > 0) {
        await settlePromoOnPurchase({
          accountId: account.id,
          mode: 'live',
          sourceType: 'revenuecat',
          sourceId: event.id,
          amountMinor,
          currency,
          amountIsFinal,
        });
      }
    } catch (error) {
      console.error('[revenuecat] settlement failed:', error);
      return json({ error: 'settle_failed' }, 500);
    }
  }

  await db
    .update(revenuecatEvents)
    .set({ processedAt: new Date() })
    .where(eq(revenuecatEvents.eventId, event.id));

  return json({ ok: true, tier, tierApplied, tierSkipReason }, 200);
}
