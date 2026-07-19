/** Core domain types — the only place shared types live (CLAUDE.md rule 1). */

export type UnitPref = 'kg' | 'lb';
export type Sex = 'male' | 'female' | 'other';
export type GoalType = 'fat_loss' | 'muscle' | 'strength';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high';
export type Tier = 'starter' | 'silver' | 'gold' | 'elite';
export type FontScale = 'normal' | 'large' | 'xlarge';
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

export interface Profile {
  id: string;
  displayName: string;
  dob: string | null; // ISO date
  sex: Sex | null;
  heightCm: number | null;
  unitPref: UnitPref;
  tier: Tier;
  goalType: GoalType | null;
  activityLevel: ActivityLevel | null;
  fontScale: FontScale;
  onboarded: boolean;
}

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  secondaryMuscles: string[];
  equipment: string | null;
  level: string | null;
  category: string | null;
  instructions: string[];
  imageUrls: string[];
}

export interface PlanExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  repRange: string; // "8-12"
  restSec: number;
}

export interface PlanWorkout {
  id: string;
  planId: string;
  week: number;
  day: number;
  name: string; // "PUSH A"
  exercises: PlanExercise[];
}

export interface Plan {
  id: string;
  name: string;
  tierRequired: Tier;
  goalType: GoalType;
  weeks: number;
  daysPerWeek: number;
  description: string;
}

export interface SetLog {
  id: string;
  workoutLogId: string;
  exerciseId: string;
  exerciseName: string;
  setNo: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  isPr: boolean;
  loggedAt: string; // ISO datetime
}

export interface WorkoutLog {
  id: string;
  date: string; // ISO date
  planWorkoutId: string | null;
  name: string;
  startedAt: string;
  finishedAt: string | null;
  durationSec: number | null;
}

/**
 * The immutable exercise shape needed to restore an in-progress workout after
 * an app restart. Logged sets remain separate; this preserves unlogged
 * template/coach exercises and their targets locally while the session is
 * active.
 */
export interface WorkoutExerciseBlueprint {
  exerciseId: string;
  exerciseName: string;
  equipment: string | null;
  targetSets: number;
  repRange: string | null;
  restSec: number;
}

export interface WorkoutSessionBlueprint {
  exercises: WorkoutExerciseBlueprint[];
}

export interface WeightLog {
  id: string;
  date: string; // ISO date, one per day
  kg: number;
}

export interface Measurement {
  id: string;
  date: string;
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  hipCm: number | null;
  thighCm: number | null;
}

/** Nutri-Score front-of-pack grade (Open Food Facts). */
export type NutriScore = 'a' | 'b' | 'c' | 'd' | 'e';

export interface FoodItem {
  id: string;
  name: string;
  brand: string | null;
  source: 'off' | 'usda' | 'custom' | 'seed';
  barcode: string | null;
  /** Macros per 100 g */
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  servingGrams: number | null;
  servingLabel: string | null;
  // Food-quality extras (optional — OFF/USDA provide them, custom/seed don't).
  /** Fiber g per 100 g. */
  fiberPer100?: number | null;
  /** Total sugars g per 100 g. */
  sugarPer100?: number | null;
  /** Sodium mg per 100 g. */
  sodiumPer100?: number | null;
  /** Nutri-Score a–e (OFF only). */
  nutriScore?: NutriScore | null;
  /** NOVA processing group 1–4 (OFF only; 4 = ultra-processed). */
  novaGroup?: 1 | 2 | 3 | 4 | null;
}

export interface FoodLog {
  id: string;
  date: string;
  meal: Meal;
  foodId: string;
  foodName: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Targets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  waterMl: number;
  /** Daily step goal (see stepsGoal in logic/macros.ts). */
  steps: number;
}

export interface Streak {
  current: number;
  best: number;
  lastWorkoutDate: string | null;
}

export interface PrRecord {
  exerciseId: string;
  exerciseName: string;
  weightKg: number;
  reps: number;
  e1rm: number;
  date: string;
}
