import type { ActivityLevel, GoalType, Sex, Targets } from '../types';

/** Macro math — pure, unit-tested (CLAUDE.md rule 10). */

export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

export function kcalFromMacros(protein: number, carbs: number, fat: number): number {
  return Math.round(
    protein * KCAL_PER_G.protein + carbs * KCAL_PER_G.carbs + fat * KCAL_PER_G.fat,
  );
}

/** Macros for a portion, given per-100 g values. Rounded to 1 decimal. */
export function scalePer100(valuePer100: number, grams: number): number {
  return Math.round(valuePer100 * grams) / 100;
}

/** Mifflin-St Jeor BMR. */
export function bmr(sex: Sex, kg: number, heightCm: number, ageYears: number): number {
  const base = 10 * kg + 6.25 * heightCm - 5 * ageYears;
  if (sex === 'male') return Math.round(base + 5);
  if (sex === 'female') return Math.round(base - 161);
  return Math.round(base - 78); // midpoint
}

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

export function tdee(bmrKcal: number, activity: ActivityLevel): number {
  return Math.round(bmrKcal * ACTIVITY_MULTIPLIER[activity]);
}

const GOAL_ADJUST: Record<GoalType, number> = {
  fat_loss: -0.2, // 20% deficit
  muscle: 0.1, // 10% surplus
  strength: 0.05,
};

/**
 * Compute daily targets from body stats and goal.
 * Protein: 1.8 g/kg (fat loss: 2.2 to protect muscle). Fat: 25% kcal. Carbs: remainder.
 */
export function computeTargets(args: {
  sex: Sex;
  kg: number;
  heightCm: number;
  ageYears: number;
  activity: ActivityLevel;
  goal: GoalType;
}): Targets {
  const maintenance = tdee(bmr(args.sex, args.kg, args.heightCm, args.ageYears), args.activity);
  const kcal = Math.round(maintenance * (1 + GOAL_ADJUST[args.goal]));
  const proteinPerKg = args.goal === 'fat_loss' ? 2.2 : 1.8;
  const protein = Math.round(args.kg * proteinPerKg);
  const fat = Math.round((kcal * 0.25) / KCAL_PER_G.fat);
  const carbs = Math.max(
    0,
    Math.round((kcal - protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat) / KCAL_PER_G.carbs),
  );
  const waterMl = Math.round((args.kg * 35) / 250) * 250; // ~35 ml/kg rounded to a glass
  return { kcal, protein, carbs, fat, waterMl };
}
