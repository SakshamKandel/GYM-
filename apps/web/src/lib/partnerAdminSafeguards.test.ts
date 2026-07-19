import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyPartnerCurrencyHistory,
  hasPartnerCurrencyHistory,
  partnerCurrencyChangeBlocked,
  summarizePartnerLiveOrders,
} from './partnerAdminSafeguards.ts';

describe('partner administration safeguards', () => {
  it('allows the same currency and a real change only for a truly empty partner', () => {
    const empty = emptyPartnerCurrencyHistory();
    assert.equal(partnerCurrencyChangeBlocked('NPR', 'NPR', empty), false);
    assert.equal(partnerCurrencyChangeBlocked('NPR', 'USD', empty), false);

    const withDeletedMenuHistory = { ...empty, menuItems: 1 };
    assert.equal(hasPartnerCurrencyHistory(withDeletedMenuHistory), true);
    assert.equal(partnerCurrencyChangeBlocked('NPR', 'USD', withDeletedMenuHistory), true);
    assert.equal(partnerCurrencyChangeBlocked('NPR', 'NPR', withDeletedMenuHistory), false);
  });

  it('treats every financial/history category as a currency blocker', () => {
    for (const key of [
      'menuItems',
      'subscriptions',
      'billingCycles',
      'orders',
      'paymentRequests',
    ] as const) {
      const history = { ...emptyPartnerCurrencyHistory(), [key]: 1 };
      assert.equal(partnerCurrencyChangeBlocked('NPR', 'USD', history), true, key);
    }
  });

  it('builds a stable live-order impact and ignores terminal or malformed rows', () => {
    assert.deepEqual(
      summarizePartnerLiveOrders([
        { status: 'pending', count: 2 },
        { status: 'preparing', count: 1 },
        { status: 'out_for_delivery', count: 3 },
        { status: 'delivered', count: 99 },
        { status: 'confirmed', count: -1 },
      ]),
      {
        total: 6,
        byStatus: { pending: 2, confirmed: 0, preparing: 1, out_for_delivery: 3 },
      },
    );
  });
});

