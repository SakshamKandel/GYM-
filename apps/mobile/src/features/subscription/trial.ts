import {
  startTrial,
  toRewardsError,
  type RewardsErrorCode,
  type TrialTier,
} from '../../lib/api/client';
import { useAuth } from '../../state/auth';

/**
 * Free tier trials — pure copy helpers + the never-throwing activation
 * wrapper the paywall (SubscribeScreen) uses. Relocated from the retired
 * buddy feature; the trial itself was never buddy-specific.
 */

/** Tiers available for trial (starter is free, no trial needed). */
export const TRIAL_TIERS = ['silver', 'gold', 'elite'] as const;

/** Friendly one-liners for trial failures — never raw server codes. */
export function trialErrorLine(code: RewardsErrorCode): string {
  switch (code) {
    case 'trial_used':
      return "You've already used your trial for this plan.";
    case 'not_an_upgrade':
      return 'Your current plan already includes this.';
    case 'invalid':
      return 'Something went wrong — try again.';
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    default:
      return "Can't start the trial — try again in a bit.";
  }
}

/** null = trial started; otherwise a typed error code. */
export async function activateTrial(tier: TrialTier): Promise<RewardsErrorCode | null> {
  const auth = useAuth.getState();
  const token = auth.status === 'signedIn' ? auth.token : null;
  if (token === null) return 'unauthorized';
  try {
    await startTrial(token, tier);
    // Do NOT mirror the trial tier into the local profile: the local tier is
    // upgrade-only and nothing reverts it, so a 2-day trial would permanently
    // unlock locally-gated surfaces. The server owns the trial (with expiry) —
    // refresh the session so useEffectiveTier picks it up everywhere now.
    await useAuth.getState().refresh();
    return null;
  } catch (err) {
    return toRewardsError(err).code;
  }
}
