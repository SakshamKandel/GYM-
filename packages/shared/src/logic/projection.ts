/**
 * Goal projection (Feature Blueprint §02): estimated timeline to target
 * weight from the CURRENT trend, with safe-rate guardrails.
 */

export interface GoalProjection {
  status: 'onTrack' | 'tooFast' | 'wrongDirection' | 'noTrend' | 'reached' | 'farOut';
  /** Whole weeks to target at the current trend rate (null unless onTrack/tooFast). */
  etaWeeks: number | null;
  /** Plain-language line for the UI. */
  message: string;
}

/** Safe weekly rates as a fraction of bodyweight. */
const SAFE_LOSS_PER_WEEK = 0.01; // lose ≤1% BW/week
const SAFE_GAIN_PER_WEEK = 0.005; // gain ≤0.5% BW/week
const MAX_PROJECT_WEEKS = 104;

export function projectGoal(input: {
  trendKg: number;
  targetKg: number;
  ratePerWeekKg: number;
}): GoalProjection {
  const { trendKg, targetKg, ratePerWeekKg } = input;
  const deltaKg = targetKg - trendKg;

  if (Math.abs(deltaKg) < 0.5) {
    return { status: 'reached', etaWeeks: null, message: 'You are at your target — hold it here.' };
  }
  if (Math.abs(ratePerWeekKg) < 0.05) {
    return {
      status: 'noTrend',
      etaWeeks: null,
      message: 'Your weight is holding steady — the timeline appears once a trend shows.',
    };
  }
  const movingTowardTarget = Math.sign(deltaKg) === Math.sign(ratePerWeekKg);
  if (!movingTowardTarget) {
    return {
      status: 'wrongDirection',
      etaWeeks: null,
      message: 'Your trend is moving away from the target right now.',
    };
  }

  const weeks = Math.ceil(Math.abs(deltaKg / ratePerWeekKg));
  if (weeks > MAX_PROJECT_WEEKS) {
    return {
      status: 'farOut',
      etaWeeks: null,
      message: 'At the current pace the target is over two years out — expect this to speed up as habits stick.',
    };
  }

  const safeLimit = deltaKg < 0 ? trendKg * SAFE_LOSS_PER_WEEK : trendKg * SAFE_GAIN_PER_WEEK;
  if (Math.abs(ratePerWeekKg) > safeLimit) {
    return {
      status: 'tooFast',
      etaWeeks: weeks,
      message:
        deltaKg < 0
          ? 'Faster than the safe band — great pace, but protect your muscle and energy.'
          : 'Gaining faster than the lean-gain band — some of this will be fat.',
    };
  }

  return {
    status: 'onTrack',
    etaWeeks: weeks,
    message: `About ${weeks} week${weeks === 1 ? '' : 's'} to target at your current pace.`,
  };
}
