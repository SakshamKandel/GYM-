import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  ActivityLevel,
  FontScale,
  GoalType,
  Sex,
  Targets,
  Tier,
  UnitPref,
} from '@gym/shared';

/** Profile + settings + targets — small, hot state persisted as JSON. */

export interface ProfileState {
  onboarded: boolean;
  displayName: string;
  sex: Sex | null;
  birthYear: number | null;
  heightCm: number | null;
  startWeightKg: number | null;
  /** Goal weight for the blueprint's goal-projection card (kg canonical). */
  targetWeightKg: number | null;
  unitPref: UnitPref;
  goalType: GoalType | null;
  activityLevel: ActivityLevel | null;
  daysPerWeek: number;
  planId: string | null;
  tier: Tier;
  fontScale: FontScale;
  targets: Targets;
  /** Last GM weekly check-in date (ISO yyyy-mm-dd). null = never run. */
  lastCheckInDate: string | null;
  /**
   * The three Sunday taps from the last check-in (energy/soreness/weekFeel,
   * each 1–3). null = never run. Kept so the reply can reflect the user's
   * self-report and the check-in step can prefill.
   */
  lastCheckInSignals: { energy: number; soreness: number; weekFeel: number } | null;
  /**
   * Anchor kcal for the adaptive engine's drift limit. Set on the first
   * check-in run; while null, readers fall back to targets.kcal.
   */
  baseKcal: number | null;
  /**
   * The account id this local profile last synced with (cloud restore or
   * backup). Guards cloud sync: a profile fingerprinted to account A must
   * never be uploaded into account B. Deliberately survives sign-out —
   * clearing it would make the guard read the profile as "never synced"
   * and hand it to the next account.
   */
  syncAccountId: string | null;

  update: (patch: Partial<ProfileData>) => void;
  completeOnboarding: (final: {
    targets: Targets;
    planId: string;
  }) => void;
  /**
   * Sign-out: drop account-derived identity (name shown on the profile card,
   * paid tier) so the next account starts clean. Device setup, targets and
   * onboarded stay — the sign-out dialog promises local data survives.
   */
  resetAccountFields: () => void;
  /**
   * A DIFFERENT account signed in on a device whose profile belongs to
   * someone else: restart from a clean slate claimed for the new account
   * (this is also what re-enables cloud backup for it). Workout logs live
   * in their own store and are untouched.
   */
  resetForAccount: (accountId: string) => void;
}

/** The data half of ProfileState — everything except the actions. */
export type ProfileData = Omit<
  ProfileState,
  'update' | 'completeOnboarding' | 'resetAccountFields' | 'resetForAccount'
>;

export const DEFAULT_TARGETS: Targets = {
  kcal: 2200,
  protein: 150,
  carbs: 220,
  fat: 60,
  waterMl: 2500,
};

/**
 * Fresh-profile values, typed as the FULL data shape so adding a field to
 * ProfileState forces a default here. Account switches and cloud restores
 * fall back to these — a missed default would leak the previous account's
 * value into the next one.
 */
export const DEFAULT_PROFILE_FIELDS: ProfileData = {
  onboarded: false,
  displayName: '',
  sex: null,
  birthYear: null,
  heightCm: null,
  startWeightKg: null,
  targetWeightKg: null,
  unitPref: 'kg',
  goalType: null,
  activityLevel: null,
  daysPerWeek: 3,
  planId: null,
  tier: 'starter',
  fontScale: 'normal',
  targets: DEFAULT_TARGETS,
  lastCheckInDate: null,
  lastCheckInSignals: null,
  baseKcal: null,
  syncAccountId: null,
};

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      ...DEFAULT_PROFILE_FIELDS,

      update: (patch) => set(patch),
      completeOnboarding: ({ targets, planId }) =>
        set({ targets, planId, onboarded: true }),
      resetAccountFields: () => set({ displayName: '', tier: 'starter' }),
      resetForAccount: (accountId) =>
        set({ ...DEFAULT_PROFILE_FIELDS, syncAccountId: accountId }),
    }),
    {
      name: 'gym-tracker-profile-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** Body-text multiplier for the in-app font-size setting (display numbers stay fixed). */
export function fontScaleMultiplier(scale: FontScale): number {
  switch (scale) {
    case 'large':
      return 1.15;
    case 'xlarge':
      return 1.3;
    default:
      return 1;
  }
}
