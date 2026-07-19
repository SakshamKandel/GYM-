import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  accountDeletionConfirmationMatches,
  buildAccountDeletionImpact,
  type AccountDeletionCounts,
} from './accountDeletion.ts';

const EMPTY_COUNTS: AccountDeletionCounts = {
  liveMealOrders: 0,
  openMealSubscriptions: 0,
  pendingMealPaymentRequests: 0,
  pendingMembershipPaymentRequests: 0,
  staffRoles: 0,
  partnerProfiles: 0,
  coachProfiles: 0,
  activeCoachAssignments: 0,
  pendingCoachRequests: 0,
  pendingCoachApplications: 0,
  pendingCoachTierRequests: 0,
  pendingCoachPayoutRequests: 0,
  matchingLegacyProfiles: 0,
  mealOrders: 0,
  mealSubscriptions: 0,
  mealPaymentRequests: 0,
  membershipPaymentRequests: 0,
  promoRedemptions: 0,
  discountGrants: 0,
  coachPayoutRequests: 0,
  walletLedgerEntries: 0,
};

describe('account deletion confirmation', () => {
  it('accepts only the explicit DELETE literal', () => {
    assert.equal(accountDeletionConfirmationMatches(ACCOUNT_DELETION_CONFIRMATION), true);
    assert.equal(accountDeletionConfirmationMatches('  DELETE  '), true);
    assert.equal(accountDeletionConfirmationMatches('delete'), false);
    assert.equal(accountDeletionConfirmationMatches(undefined), false);
  });
});

describe('account deletion impact', () => {
  it('allows a plain member with no retained or operational dependencies', () => {
    assert.deepEqual(buildAccountDeletionImpact(EMPTY_COUNTS), {
      canDelete: true,
      blockers: [],
      retainedHistory: {
        mealOrders: 0,
        mealSubscriptions: 0,
        mealPaymentRequests: 0,
        membershipPaymentRequests: 0,
        promoRedemptions: 0,
        discountGrants: 0,
        coachPayoutRequests: 0,
        walletLedgerEntries: 0,
      },
    });
  });

  it('reports live services and offboarding dependencies with stable counts', () => {
    const impact = buildAccountDeletionImpact({
      ...EMPTY_COUNTS,
      liveMealOrders: 2,
      openMealSubscriptions: 1,
      staffRoles: 1,
      partnerProfiles: 1,
      activeCoachAssignments: 3,
      pendingCoachRequests: 2,
    });

    assert.equal(impact.canDelete, false);
    assert.deepEqual(impact.blockers.slice(0, 5), [
      { code: 'live_meal_orders', count: 2 },
      { code: 'open_meal_subscriptions', count: 1 },
      { code: 'staff_offboarding_required', count: 1 },
      { code: 'partner_offboarding_required', count: 1 },
      { code: 'coach_offboarding_required', count: 5 },
    ]);
  });

  it('never allows hard deletion to cascade retained commerce or money history', () => {
    const impact = buildAccountDeletionImpact({
      ...EMPTY_COUNTS,
      mealOrders: 4,
      mealSubscriptions: 1,
      mealPaymentRequests: 2,
      membershipPaymentRequests: 3,
      promoRedemptions: 1,
      discountGrants: 2,
      coachPayoutRequests: 1,
      walletLedgerEntries: 6,
    });

    assert.equal(impact.canDelete, false);
    assert.deepEqual(impact.blockers, [
      { code: 'retained_commerce_history', count: 5 },
      { code: 'retained_financial_history', count: 15 },
    ]);
  });

  it('fails closed when a legacy email maps to multiple old profiles', () => {
    const impact = buildAccountDeletionImpact({
      ...EMPTY_COUNTS,
      matchingLegacyProfiles: 2,
    });

    assert.deepEqual(impact.blockers, [
      { code: 'legacy_identity_ambiguous', count: 2 },
    ]);
  });

  it('normalizes invalid count inputs to zero', () => {
    const impact = buildAccountDeletionImpact({
      ...EMPTY_COUNTS,
      liveMealOrders: -2,
      mealOrders: Number.NaN,
    });
    assert.equal(impact.canDelete, true);
  });
});
