import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '../../lib/mmkvStorage';
import {
  ACTIVITY_OPTIONS,
  BIRTH_YEAR,
  DAYS_PER_WEEK,
  DEFAULT_DRAFT,
  GOAL_OPTIONS,
  HEIGHT_CM,
  SEX_OPTIONS,
  TOTAL_STEPS,
  UNIT_OPTIONS,
  WEIGHT_RANGES,
  type OnboardingDraft,
} from './logic';

/**
 * Onboarding progress that SURVIVES the app being killed.
 *
 * The wizard used to hold its step and answers in component state and write
 * nothing until the very last step, so a phone call, a low-memory kill or a
 * mistap on the app switcher threw away every answer and dropped the member
 * back on question 1. Step + draft now live here, persisted on every change.
 *
 * Writes are fire-and-forget by construction: zustand's persist middleware
 * updates memory synchronously and hands the serialized blob to storage
 * afterwards without awaiting it, so an option tap still repaints instantly
 * (MMKV is a synchronous native write anyway; web goes through AsyncStorage).
 *
 * Cleared the moment onboarding completes — a finished run must never
 * resurrect a half-filled wizard on the next launch.
 */

interface OnboardingProgressState {
  /** 1-based wizard step, always within [1, TOTAL_STEPS]. */
  step: number;
  draft: OnboardingDraft;
  setStep: (step: number) => void;
  patchDraft: (patch: Partial<OnboardingDraft>) => void;
}

const STORAGE_KEY = 'gym-tracker-onboarding-progress-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The persisted value if it's one of `allowed`, else null. No casts. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((option) => option === value) ?? null;
}

/** A finite number clamped into the step's range, else the draft default. */
function inRange(
  value: unknown,
  range: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

function clampStep(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(TOTAL_STEPS, Math.max(1, Math.round(value)));
}

/**
 * Step numbers moved in v2: the opening screen that collected nothing is gone,
 * and the units question now comes before height and weight. A run saved by an
 * older build has to be pointed at the question it was really on — otherwise a
 * member who put the phone down mid-setup comes back either repeating an
 * answer or, worse, past a question that never got asked.
 *
 * Height (old 5) and units (old 6) both land on the new units question: under
 * the old order neither of them had been asked units yet, and that is now the
 * question that comes first.
 */
const V1_TO_V2_STEP: Record<number, number> = {
  1: 1, // intro → the name question that absorbed it
  2: 1, // name
  3: 2, // sex
  4: 3, // born
  5: 4, // height → units, which now precedes it
  6: 4, // units
  7: 6, // weight
  8: 7, // goal
  9: 8, // activity
  10: 9, // days a week
  11: 10, // stay on track
  12: 11, // targets + account
};

/**
 * Rebuild a draft from whatever was on disk, field by field. The blob can come
 * from an older build (a field the wizard has since added is simply missing) or
 * from a corrupted file, and a bad number here would feed the steppers values
 * outside their own min/max — so nothing is trusted: every field falls back to
 * its default and every number is clamped to the range its step allows.
 */
function sanitizeDraft(raw: unknown): OnboardingDraft {
  if (!isRecord(raw)) return DEFAULT_DRAFT;
  const unitPref =
    oneOf(raw['unitPref'], UNIT_OPTIONS.map((o) => o.value)) ?? DEFAULT_DRAFT.unitPref;
  return {
    name: typeof raw['name'] === 'string' ? raw['name'].slice(0, 24) : DEFAULT_DRAFT.name,
    sex: oneOf(raw['sex'], SEX_OPTIONS.map((o) => o.value)),
    birthYear: inRange(raw['birthYear'], BIRTH_YEAR, DEFAULT_DRAFT.birthYear),
    heightCm: inRange(raw['heightCm'], HEIGHT_CM, DEFAULT_DRAFT.heightCm),
    unitPref,
    weightInput: inRange(
      raw['weightInput'],
      WEIGHT_RANGES[unitPref],
      DEFAULT_DRAFT.weightInput,
    ),
    goal: oneOf(raw['goal'], GOAL_OPTIONS.map((o) => o.value)),
    activity: oneOf(raw['activity'], ACTIVITY_OPTIONS.map((o) => o.value)),
    daysPerWeek: inRange(raw['daysPerWeek'], DAYS_PER_WEEK, DEFAULT_DRAFT.daysPerWeek),
  };
}

/**
 * Whether the read from storage has SETTLED — landed or failed. Tracked here
 * rather than through `persist.hasHydrated()`, which stays false forever when
 * the read rejects (an unreadable web storage would leave the wizard staring at
 * a blank screen). The wizard must paint either way; a failed read just means
 * there is no run to resume.
 */
let hydrationSettled = false;
const hydrationListeners = new Set<() => void>();

function settleHydration(): void {
  if (hydrationSettled) return;
  hydrationSettled = true;
  for (const notify of [...hydrationListeners]) notify();
  hydrationListeners.clear();
}

export const useOnboardingProgress = create<OnboardingProgressState>()(
  persist(
    (set) => ({
      step: 1,
      draft: DEFAULT_DRAFT,
      setStep: (step) => set({ step: clampStep(step) }),
      patchDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (s) => ({ step: s.step, draft: s.draft }),
      version: 2,
      // Answers are always kept — only the step pointer is remapped.
      migrate: (persisted, version) => {
        if (!isRecord(persisted) || version >= 2) return persisted;
        const raw = persisted['step'];
        const old =
          typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 1;
        return { ...persisted, step: V1_TO_V2_STEP[old] ?? 1 };
      },
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current;
        return {
          ...current,
          step: clampStep(persisted['step']),
          draft: sanitizeDraft(persisted['draft']),
        };
      },
      // Runs after a successful read, after an empty one, AND after a failed
      // one — the only callback zustand fires on every path.
      onRehydrateStorage: () => settleHydration,
    },
  ),
);

/**
 * Forget the saved run — called once setup is committed to the profile, so a
 * finished onboarding can never resurrect as a half-filled wizard.
 *
 * Lives outside the store (rather than as an action) so it can reach
 * `persist.clearStorage()` without the store's own type referring to itself.
 * Order matters: the reset below writes the defaults back to storage, then the
 * key is dropped entirely, leaving nothing to rehydrate.
 */
export function clearOnboardingProgress(): void {
  useOnboardingProgress.setState({ step: 1, draft: DEFAULT_DRAFT });
  useOnboardingProgress.persist.clearStorage();
}

/**
 * True once the saved run has been read back from storage (or the read has
 * failed). Native MMKV reads synchronously, so this is already true on the
 * first render; web storage resolves a tick later, and without the gate the
 * wizard would paint question 1 and then jump to the resumed step — which
 * reads as "it lost my answers" for exactly one frame.
 */
export function useOnboardingProgressHydrated(): boolean {
  const [hydrated, setHydrated] = useState(hydrationSettled);

  useEffect(() => {
    if (hydrated) return;
    const notify = (): void => setHydrated(true);
    hydrationListeners.add(notify);
    // It may have settled between the initial read and this effect.
    if (hydrationSettled) notify();
    return () => {
      hydrationListeners.delete(notify);
    };
  }, [hydrated]);

  return hydrated;
}
