import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deepLinkForNotification } from './notificationRouting.ts';

/**
 * Every `data.type` the server can send, paired with the screen a tap must
 * open. Derived from apps/web's `notify(...)` / `sendPushToAccount(...)` call
 * sites (plus the broadcast route's BROADCAST_DATA), not invented here.
 *
 * A type missing from the switch makes the tap do nothing, which reads as a
 * broken notification — so a new sender must be added to BOTH the routing
 * module and this table.
 */
const ROUTE_BY_TYPE = {
  // ── Member-facing ────────────────────────────────────────────
  order: '/meals/orders',
  meal_order: '/meals/orders',
  meal_payment_decided: '/meals/orders',
  cycle: '/meals/subscriptions',
  meal_cycle: '/meals/subscriptions',
  meal_subscription_updated: '/meals/subscriptions',
  tier: '/subscribe',
  payment_decided: '/subscribe',
  coach_chat: '/coach-chat',
  coach: '/coach-chat',
  coach_plan: '/(tabs)/train',
  suggestion_reviewed: '/(tabs)/train',
  coach_request_decided: '/coaches',
  application_decided: '/coaches/apply',
  milestone: '/(tabs)/progress',
  badge_earned: '/badges',
  badge_verified: '/badges',
  checkin_reply: '/(tabs)',
  home: '/(tabs)',
  support: '/support',
  support_reply: '/support',
  broadcast: '/notifications',
  // Id-addressed senders, here without an id — the fallback screen.
  gym: '/gyms/saved',
  coach_client: '/staff/coach',

  // ── Coach console ────────────────────────────────────────────
  coach_request: '/staff/coach',
  tier_request_decided: '/staff/coach/profile',
  payout_decided: '/staff/coach/wallet',

  // ── Staff console (inbound-work fan-outs) ────────────────────
  coach_application: '/staff/admin/applications',
  meal_payment: '/staff/admin/meal-payments',
  payment_request: '/staff/admin/payments',
};

describe('notification deep-link routing', () => {
  it('opens a screen for every type the server sends', () => {
    for (const [type, route] of Object.entries(ROUTE_BY_TYPE)) {
      assert.equal(deepLinkForNotification({ type }), route, `type=${type}`);
    }
  });

  it('leaves the partner-only payout notification deliberately unmapped', () => {
    // 'payout' addresses a restaurant PARTNER account, and the partner portal is
    // web-only — there is no mobile screen to open.
    assert.equal(deepLinkForNotification({ type: 'payout' }), null);
  });

  it('carries the row id into the two id-addressed routes, encoded', () => {
    assert.equal(
      deepLinkForNotification({ type: 'gym', id: 'wave-health-club-ktm' }),
      '/gyms/wave-health-club-ktm',
    );
    assert.equal(
      deepLinkForNotification({ type: 'coach_client', id: 'member-a' }),
      '/staff/coach/client/member-a',
    );
    assert.equal(deepLinkForNotification({ type: 'gym', id: 'a b/c' }), '/gyms/a%20b%2Fc');
  });

  it('navigates nowhere on a payload with no usable type', () => {
    assert.equal(deepLinkForNotification(null), null);
    assert.equal(deepLinkForNotification(undefined), null);
    assert.equal(deepLinkForNotification({}), null);
    assert.equal(deepLinkForNotification({ type: '' }), null);
    assert.equal(deepLinkForNotification({ type: 42 }), null);
    assert.equal(deepLinkForNotification({ type: 'not_a_sender' }), null);
  });
});
