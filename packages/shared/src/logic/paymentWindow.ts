import type { Tier } from '../types';

const TIER_RANK: Record<Tier, number> = { starter: 0, silver: 1, gold: 2, elite: 3 };

export interface PaidTierWindowPlan {
  /** Undefined preserves the original start date when extending a live tier. */
  startsAt: Date | undefined;
  expiresAt: Date;
  needsConfirm: boolean;
  confirmReason?: 'permanent_current' | 'higher_current';
  action: 'extend' | 'overwrite';
}

/**
 * Adds calendar months in UTC and clamps to the target month's last day.
 * This keeps 31 January + one month valid and makes twelve months a true year.
 */
export function addCalendarMonths(base: Date, months: number): Date {
  if (!Number.isInteger(months)) throw new RangeError('months must be an integer');
  const monthIndex = base.getUTCMonth() + months;
  const targetYear = base.getUTCFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(base.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

/** Plans an approved manual-payment tier window from a frozen prior state. */
export function planPaidTierWindow(
  currentTier: Tier,
  currentExpiresAt: Date | null,
  purchasedTier: Tier,
  months: number,
  now: Date,
): PaidTierWindowPlan {
  const currentEffective: Tier =
    currentTier !== 'starter' &&
    currentExpiresAt !== null &&
    currentExpiresAt.getTime() < now.getTime()
      ? 'starter'
      : currentTier;
  const currentActive =
    currentEffective !== 'starter' &&
    (currentExpiresAt === null || currentExpiresAt.getTime() > now.getTime());
  const currentPermanent = currentEffective !== 'starter' && currentExpiresAt === null;
  const comparison = TIER_RANK[currentEffective] - TIER_RANK[purchasedTier];

  if (comparison === 0 && currentActive && !currentPermanent && currentExpiresAt) {
    return {
      startsAt: undefined,
      expiresAt: addCalendarMonths(currentExpiresAt, months),
      needsConfirm: false,
      action: 'extend',
    };
  }

  if (currentActive && (comparison > 0 || currentPermanent)) {
    return {
      startsAt: now,
      expiresAt: addCalendarMonths(now, months),
      needsConfirm: true,
      confirmReason: currentPermanent ? 'permanent_current' : 'higher_current',
      action: 'overwrite',
    };
  }

  return {
    startsAt: now,
    expiresAt: addCalendarMonths(now, months),
    needsConfirm: false,
    action: 'overwrite',
  };
}
