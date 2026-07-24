import type {
  ActivityLevel,
  GoalType,
  Sex,
  Targets,
  UnitPref,
} from '@gym/shared';
import { computeTargets, inputToKg } from '@gym/shared';

/** Pure onboarding/settings logic — no React, no IO. */

export const TOTAL_STEPS = 12;

/** Everything the wizard collects before it commits to the profile store. */
export interface OnboardingDraft {
  name: string;
  sex: Sex | null;
  birthYear: number;
  heightCm: number;
  unitPref: UnitPref;
  /** Weight as typed/stepped, in `unitPref` units (canonical kg only at commit). */
  weightInput: number;
  goal: GoalType | null;
  activity: ActivityLevel | null;
  daysPerWeek: number;
}

export const DEFAULT_DRAFT: OnboardingDraft = {
  name: '',
  sex: null,
  birthYear: 1995,
  heightCm: 172,
  unitPref: 'kg',
  weightInput: 75,
  goal: null,
  activity: null,
  daysPerWeek: 3,
};

export interface Option<T extends string> {
  value: T;
  title: string;
  subtitle?: string;
}

export const SEX_OPTIONS: Option<Sex>[] = [
  { value: 'male', title: 'Male' },
  { value: 'female', title: 'Female' },
  { value: 'other', title: 'Other' },
];

export const UNIT_OPTIONS: Option<UnitPref>[] = [
  { value: 'kg', title: 'Kilograms', subtitle: 'kg — plates in most gyms' },
  { value: 'lb', title: 'Pounds', subtitle: 'lb — common in the US' },
];

export const GOAL_OPTIONS: Option<GoalType>[] = [
  { value: 'fat_loss', title: 'Lose fat', subtitle: 'Eat in a deficit, keep your muscle' },
  { value: 'muscle', title: 'Build muscle', subtitle: 'Lean surplus, grow with volume' },
  { value: 'strength', title: 'Get stronger', subtitle: 'Heavy compounds, bigger lifts' },
];

export const ACTIVITY_OPTIONS: Option<ActivityLevel>[] = [
  { value: 'sedentary', title: 'Mostly sitting', subtitle: 'Desk job, not much walking' },
  { value: 'light', title: 'Lightly active', subtitle: 'Walks or light chores most days' },
  { value: 'moderate', title: 'Active', subtitle: 'On your feet a lot of the day' },
  { value: 'high', title: 'Very active', subtitle: 'Physical job or daily sport' },
];

/** Stepper defaults per unit (display units, not kg). */
export const WEIGHT_DEFAULTS: Record<UnitPref, number> = { kg: 75, lb: 165 };
export const WEIGHT_STEPS: Record<UnitPref, number> = { kg: 0.5, lb: 1 };
export const WEIGHT_RANGES: Record<UnitPref, { min: number; max: number }> = {
  kg: { min: 30, max: 250 },
  lb: { min: 66, max: 550 },
};

export const BIRTH_YEAR = { default: 1995, min: 1930, max: 2015 } as const;
export const HEIGHT_CM = { default: 172, min: 120, max: 220 } as const;
export const DAYS_PER_WEEK = { default: 3, min: 2, max: 6 } as const;

/** Coarse age: current year minus birth year (good enough for BMR). */
export function ageFromBirthYear(
  birthYear: number,
  nowYear: number = new Date().getFullYear(),
): number {
  return Math.max(10, nowYear - birthYear);
}

/** Targets from a completed draft (falls back safely if a step was skipped). */
export function draftTargets(d: OnboardingDraft): Targets {
  return computeTargets({
    sex: d.sex ?? 'other',
    kg: inputToKg(d.weightInput, d.unitPref),
    heightCm: d.heightCm,
    ageYears: ageFromBirthYear(d.birthYear),
    activity: d.activity ?? 'light',
    goal: d.goal ?? 'muscle',
  });
}

/**
 * Recalculate targets from stored profile fields (Settings).
 * Returns null when the profile is missing a required field.
 */
export function recalcTargets(args: {
  sex: Sex | null;
  birthYear: number | null;
  heightCm: number | null;
  goal: GoalType | null;
  activity: ActivityLevel | null;
  kg: number | null;
}): Targets | null {
  if (
    args.sex === null ||
    args.birthYear === null ||
    args.heightCm === null ||
    args.goal === null ||
    args.activity === null ||
    args.kg === null
  ) {
    return null;
  }
  return computeTargets({
    sex: args.sex,
    kg: args.kg,
    heightCm: args.heightCm,
    ageYears: ageFromBirthYear(args.birthYear),
    activity: args.activity,
    goal: args.goal,
  });
}

/** One-decimal display for half-kg steps ("75" not "75.0", "75.5" stays). */
export function formatWeightValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
