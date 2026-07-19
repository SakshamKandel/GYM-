/**
 * Stable account-deletion contract shared by the API and mobile client.
 *
 * The route supplies counts from Postgres; this module only turns them into a
 * deterministic, typed impact response. Keeping that decision pure makes it
 * possible to regression-test every blocker without a live database.
 */

export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE' as const;

export const ACCOUNT_DELETION_BLOCKER_CODES = [
  'live_meal_orders',
  'open_meal_subscriptions',
  'pending_meal_payment_requests',
  'pending_membership_payment_requests',
  'staff_offboarding_required',
  'partner_offboarding_required',
  'coach_offboarding_required',
  'legacy_identity_ambiguous',
  'retained_commerce_history',
  'retained_financial_history',
] as const;

export type AccountDeletionBlockerCode =
  (typeof ACCOUNT_DELETION_BLOCKER_CODES)[number];

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  count: number;
}

export interface AccountDeletionRetainedHistory {
  mealOrders: number;
  mealSubscriptions: number;
  mealPaymentRequests: number;
  membershipPaymentRequests: number;
  promoRedemptions: number;
  discountGrants: number;
  coachPayoutRequests: number;
  walletLedgerEntries: number;
}

export interface AccountDeletionImpact {
  canDelete: boolean;
  blockers: AccountDeletionBlocker[];
  retainedHistory: AccountDeletionRetainedHistory;
}

/** Raw counts loaded by the server. Every value must be a non-negative integer. */
export interface AccountDeletionCounts extends AccountDeletionRetainedHistory {
  liveMealOrders: number;
  openMealSubscriptions: number;
  pendingMealPaymentRequests: number;
  pendingMembershipPaymentRequests: number;
  staffRoles: number;
  partnerProfiles: number;
  coachProfiles: number;
  activeCoachAssignments: number;
  pendingCoachRequests: number;
  pendingCoachApplications: number;
  pendingCoachTierRequests: number;
  pendingCoachPayoutRequests: number;
  matchingLegacyProfiles: number;
}

/** Network-boundary confirmation check; whitespace around the literal is harmless. */
export function accountDeletionConfirmationMatches(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim() === ACCOUNT_DELETION_CONFIRMATION
  );
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Build the stable 409 impact object returned when deletion is unsafe. */
export function buildAccountDeletionImpact(
  raw: AccountDeletionCounts,
): AccountDeletionImpact {
  const counts: AccountDeletionCounts = {
    liveMealOrders: safeCount(raw.liveMealOrders),
    openMealSubscriptions: safeCount(raw.openMealSubscriptions),
    pendingMealPaymentRequests: safeCount(raw.pendingMealPaymentRequests),
    pendingMembershipPaymentRequests: safeCount(raw.pendingMembershipPaymentRequests),
    staffRoles: safeCount(raw.staffRoles),
    partnerProfiles: safeCount(raw.partnerProfiles),
    coachProfiles: safeCount(raw.coachProfiles),
    activeCoachAssignments: safeCount(raw.activeCoachAssignments),
    pendingCoachRequests: safeCount(raw.pendingCoachRequests),
    pendingCoachApplications: safeCount(raw.pendingCoachApplications),
    pendingCoachTierRequests: safeCount(raw.pendingCoachTierRequests),
    pendingCoachPayoutRequests: safeCount(raw.pendingCoachPayoutRequests),
    matchingLegacyProfiles: safeCount(raw.matchingLegacyProfiles),
    mealOrders: safeCount(raw.mealOrders),
    mealSubscriptions: safeCount(raw.mealSubscriptions),
    mealPaymentRequests: safeCount(raw.mealPaymentRequests),
    membershipPaymentRequests: safeCount(raw.membershipPaymentRequests),
    promoRedemptions: safeCount(raw.promoRedemptions),
    discountGrants: safeCount(raw.discountGrants),
    coachPayoutRequests: safeCount(raw.coachPayoutRequests),
    walletLedgerEntries: safeCount(raw.walletLedgerEntries),
  };

  const blockers: AccountDeletionBlocker[] = [];
  const add = (code: AccountDeletionBlockerCode, count: number): void => {
    if (count > 0) blockers.push({ code, count });
  };

  add('live_meal_orders', counts.liveMealOrders);
  add('open_meal_subscriptions', counts.openMealSubscriptions);
  add('pending_meal_payment_requests', counts.pendingMealPaymentRequests);
  add('pending_membership_payment_requests', counts.pendingMembershipPaymentRequests);
  add('staff_offboarding_required', counts.staffRoles);
  add('partner_offboarding_required', counts.partnerProfiles);
  add(
    'coach_offboarding_required',
    counts.coachProfiles +
      counts.activeCoachAssignments +
      counts.pendingCoachRequests +
      counts.pendingCoachApplications +
      counts.pendingCoachTierRequests +
      counts.pendingCoachPayoutRequests,
  );
  if (counts.matchingLegacyProfiles > 1) {
    add('legacy_identity_ambiguous', counts.matchingLegacyProfiles);
  }

  const retainedHistory: AccountDeletionRetainedHistory = {
    mealOrders: counts.mealOrders,
    mealSubscriptions: counts.mealSubscriptions,
    mealPaymentRequests: counts.mealPaymentRequests,
    membershipPaymentRequests: counts.membershipPaymentRequests,
    promoRedemptions: counts.promoRedemptions,
    discountGrants: counts.discountGrants,
    coachPayoutRequests: counts.coachPayoutRequests,
    walletLedgerEntries: counts.walletLedgerEntries,
  };

  add(
    'retained_commerce_history',
    retainedHistory.mealOrders + retainedHistory.mealSubscriptions,
  );
  add(
    'retained_financial_history',
    retainedHistory.mealPaymentRequests +
      retainedHistory.membershipPaymentRequests +
      retainedHistory.promoRedemptions +
      retainedHistory.discountGrants +
      retainedHistory.coachPayoutRequests +
      retainedHistory.walletLedgerEntries,
  );

  return { canDelete: blockers.length === 0, blockers, retainedHistory };
}
