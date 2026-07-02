import { OnboardingWizard } from '../../features/onboarding/OnboardingWizard';

/**
 * /onboarding — the character-guided setup. No account required: signing in
 * is optional and offered from Welcome and Settings (it unlocks sync,
 * buddies and paid tiers).
 */
export default function OnboardingScreen() {
  return <OnboardingWizard />;
}
