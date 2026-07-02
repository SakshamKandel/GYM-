import type { FoodItem, FoodLog, Meal, Targets } from '@gym/shared';
import { kcalFromMacros, scalePer100 } from '@gym/shared';
import { addDays, lastNDays, todayIso } from '../../lib/dates';

/** Pure nutrition logic — no React, no IO. Screens stay thin. */

export const MEALS: readonly { key: Meal; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snacks', label: 'Snacks' },
] as const;

export function mealLabel(meal: Meal): string {
  return MEALS.find((m) => m.key === meal)?.label ?? 'Snacks';
}

const MEAL_KEYS: readonly string[] = ['breakfast', 'lunch', 'dinner', 'snacks'];

export function isMeal(value: unknown): value is Meal {
  return typeof value === 'string' && MEAL_KEYS.includes(value);
}

/** Meal a "log now" action defaults to, by hour of day. */
export function defaultMealForHour(hour: number): Meal {
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 18) return 'snacks';
  if (hour < 22) return 'dinner';
  return 'snacks';
}

/** First value of an expo-router search param. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseMealParam(value: string | string[] | undefined, fallback?: Meal): Meal {
  const v = firstParam(value);
  if (isMeal(v)) return v;
  return fallback ?? defaultMealForHour(new Date().getHours());
}

export function parseDateParam(value: string | string[] | undefined): string {
  const v = firstParam(value);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayIso();
}

export function parseStringParam(value: string | string[] | undefined): string {
  return firstParam(value) ?? '';
}

// ── Day math ──────────────────────────────────────────────────

export interface DayTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function sumDayTotals(logs: FoodLog[]): DayTotals {
  const out: DayTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const l of logs) {
    out.kcal += l.kcal;
    out.protein += l.protein;
    out.carbs += l.carbs;
    out.fat += l.fat;
  }
  return out;
}

/** Macros still to eat today: targets − eaten, floored at 0. */
export function remainingMacros(targets: Targets, totals: DayTotals): DayTotals {
  return {
    kcal: Math.max(0, targets.kcal - totals.kcal),
    protein: Math.max(0, targets.protein - totals.protein),
    carbs: Math.max(0, targets.carbs - totals.carbs),
    fat: Math.max(0, targets.fat - totals.fat),
  };
}

export function sumKcal(logs: FoodLog[]): number {
  return Math.round(logs.reduce((acc, l) => acc + l.kcal, 0));
}

export function groupByMeal(logs: FoodLog[]): Record<Meal, FoodLog[]> {
  const out: Record<Meal, FoodLog[]> = { breakfast: [], lunch: [], dinner: [], snacks: [] };
  for (const l of logs) out[l.meal].push(l);
  return out;
}

/**
 * Kcal ring center content. Adherence-neutral: over target the ring simply
 * completes and we state the overshoot plainly in dim text — never red.
 */
export function kcalRingState(
  eaten: number,
  target: number,
): { value: string; caption: string; over: boolean } {
  const diff = Math.round(target - eaten);
  if (diff >= 0) return { value: String(diff), caption: 'left', over: false };
  return { value: `+${-diff}`, caption: 'over', over: true };
}

// ── Day strip ─────────────────────────────────────────────────

/** Matches DayStrip defaults (14 back, 3 forward). */
export const STRIP_DAYS_BACK = 14;
export const STRIP_DAYS_FORWARD = 3;

export function stripDates(today = todayIso()): string[] {
  return lastNDays(STRIP_DAYS_BACK + STRIP_DAYS_FORWARD + 1, addDays(today, STRIP_DAYS_FORWARD));
}

export function markedDatesFromKcal(kcalByDate: Record<string, number>): Set<string> {
  const out = new Set<string>();
  for (const [date, kcal] of Object.entries(kcalByDate)) {
    if (kcal > 0) out.add(date);
  }
  return out;
}

// ── Water ─────────────────────────────────────────────────────

/** ml → litres with 1 decimal ("1.5", "2.0"). */
export function litres(ml: number): string {
  return (Math.round(Math.max(0, ml) / 100) / 10).toFixed(1);
}

// ── Portions ──────────────────────────────────────────────────

/** Rounded per-portion values for display panels. */
export function portionMacros(food: FoodItem, grams: number): DayTotals {
  return {
    kcal: Math.round(scalePer100(food.kcalPer100, grams)),
    protein: Math.round(scalePer100(food.proteinPer100, grams)),
    carbs: Math.round(scalePer100(food.carbsPer100, grams)),
    fat: Math.round(scalePer100(food.fatPer100, grams)),
  };
}

export function buildFoodLog(args: {
  id: string;
  date: string;
  meal: Meal;
  food: FoodItem;
  grams: number;
}): FoodLog {
  const { id, date, meal, food, grams } = args;
  return {
    id,
    date,
    meal,
    foodId: food.id,
    foodName: food.name,
    grams,
    kcal: Math.round(scalePer100(food.kcalPer100, grams)),
    protein: scalePer100(food.proteinPer100, grams),
    carbs: scalePer100(food.carbsPer100, grams),
    fat: scalePer100(food.fatPer100, grams),
  };
}

/**
 * "Copy yesterday" clone (blueprint §03: logging under 10 seconds):
 * same foods, same meal buckets, same portions — fresh ids, new date.
 * Pure — the caller supplies the id factory.
 */
export function cloneLogsToDate(logs: FoodLog[], date: string, makeId: () => string): FoodLog[] {
  return logs.map((log) => ({ ...log, id: makeId(), date }));
}

/** Micro-tag for search rows: where a food item comes from. Seeded library foods carry no tag. */
export function sourceTagLabel(source: FoodItem['source']): string | null {
  if (source === 'off') return 'OFF';
  if (source === 'usda') return 'USDA';
  if (source === 'custom') return 'MINE';
  return null;
}

/**
 * Custom-food sanity check: if the stated kcal differs from the
 * macro-implied kcal by more than 15%, return the implied value
 * (informational caption only — never blocks saving).
 */
export function impliedKcalMismatch(
  statedKcal: number,
  protein: number,
  carbs: number,
  fat: number,
): number | null {
  const implied = kcalFromMacros(protein, carbs, fat);
  if (statedKcal <= 0) return implied > 0 ? implied : null;
  return Math.abs(statedKcal - implied) > statedKcal * 0.15 ? implied : null;
}

/** Drop remote results already present in the local list (avoid dupes). */
export function dedupeAgainstLocal(remote: FoodItem[], local: FoodItem[]): FoodItem[] {
  const localIds = new Set(local.map((f) => f.id));
  return remote.filter((f) => !localIds.has(f.id));
}
