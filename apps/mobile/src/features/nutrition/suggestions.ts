import type { FoodItem } from '@gym/shared';
import { KCAL_PER_G, scalePer100 } from '@gym/shared';
import type { DayTotals } from './logic';

/**
 * GM food suggestions — pure ranking, no React, no IO (Gold-tier feature).
 * Given what's left of today's targets, rank foods the member has actually
 * logged, favorited, or saved from a live provider. The caller owns IO so
 * this module remains deterministic and testable.
 * serving fills the gap: protein-dense while protein is behind, then
 * balanced / carb options once protein is done.
 */

export interface FoodSuggestion {
  food: FoodItem;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Plain-language reason, e.g. "31g protein · fits your remaining 640 kcal". */
  line: string;
}

/** Below this many kcal left, suggesting more food makes no sense. */
export const MIN_SUGGEST_KCAL = 80;

/** Remaining protein (g) above which we chase protein-dense foods. */
const PROTEIN_GAP_G = 15;

/** A serving may run slightly over budget — the portion screen lets it shrink. */
const KCAL_OVERSHOOT = 1.15;

/** Diversity: at most this many suggestions per dominant macro profile. */
const MAX_PER_PROFILE = 2;

type MacroProfile = 'protein' | 'carb' | 'fat' | 'balanced';

/** Which macro dominates a food's energy (protein ≥40%, carbs ≥60%, fat ≥55%). */
export function macroProfile(food: FoodItem): MacroProfile {
  const pKcal = food.proteinPer100 * KCAL_PER_G.protein;
  const cKcal = food.carbsPer100 * KCAL_PER_G.carbs;
  const fKcal = food.fatPer100 * KCAL_PER_G.fat;
  const total = pKcal + cKcal + fKcal;
  if (total <= 0) return 'balanced';
  if (pKcal / total >= 0.4) return 'protein';
  if (cKcal / total >= 0.6) return 'carb';
  if (fKcal / total >= 0.55) return 'fat';
  return 'balanced';
}

function buildLine(remainingKcal: number, kcal: number, protein: number, proteinMode: boolean): string {
  if (!proteinMode) return "Protein's done — this tops up energy";
  const left = Math.round(remainingKcal);
  const p = Math.round(protein);
  if (kcal > left) return `${p}g protein · a touch over your ${left} kcal`;
  return `${p}g protein · fits your remaining ${left} kcal`;
}

interface Candidate {
  suggestion: FoodSuggestion;
  profile: MacroProfile;
  score: number;
}

/**
 * Rank the supplied real food history against the macros still left today.
 * Returns up to `count` suggestions, best first — or [] when the day
 * is essentially eaten up (< MIN_SUGGEST_KCAL left).
 */
export function suggestFoods(
  foods: readonly FoodItem[],
  remaining: DayTotals,
  count = 6,
): FoodSuggestion[] {
  if (remaining.kcal < MIN_SUGGEST_KCAL) return [];
  const proteinMode = remaining.protein >= PROTEIN_GAP_G;

  const candidates: Candidate[] = [];
  for (const food of foods) {
    const grams = Math.max(5, Math.round(food.servingGrams ?? 100));
    const kcal = Math.round(scalePer100(food.kcalPer100, grams));
    // Skip portions that blow well past the remaining budget.
    if (kcal <= 0 || kcal > remaining.kcal * KCAL_OVERSHOOT) continue;

    const protein = scalePer100(food.proteinPer100, grams);
    const carbs = scalePer100(food.carbsPer100, grams);
    const fat = scalePer100(food.fatPer100, grams);
    const profile = macroProfile(food);

    let score = 0;
    // Portion-size fit: sweet spot is a serving using ~35% of what's left.
    const ratio = kcal / remaining.kcal;
    score += 20 - Math.abs(ratio - 0.35) * 40;
    // Penalize (don't exclude) servings just over budget — they can be trimmed.
    if (kcal > remaining.kcal) score -= 30;

    if (proteinMode) {
      // Protein gap open: reward protein that actually closes it + density.
      score += Math.min(protein, remaining.protein) * 2.2;
      score += ((protein * KCAL_PER_G.protein) / kcal) * 10;
    } else {
      // Protein's done: favor balanced/carb energy, don't pile on more protein.
      if (profile === 'carb' || profile === 'balanced') score += 18;
      score += Math.min(carbs, Math.max(remaining.carbs, 0)) * 0.35;
      score -= Math.max(0, protein - 15) * 0.6;
    }
    // Going past the fat target is the easiest way to overshoot — nudge down.
    score -= Math.max(0, fat - Math.max(remaining.fat, 0)) * 0.8;

    candidates.push({
      profile,
      score,
      suggestion: {
        food,
        grams,
        kcal,
        protein: Math.round(protein),
        carbs: Math.round(carbs),
        fat: Math.round(fat),
        line: buildLine(remaining.kcal, kcal, protein, proteinMode),
      },
    });
  }

  // Deterministic: score first, name as tiebreak.
  candidates.sort(
    (a, b) => b.score - a.score || a.suggestion.food.name.localeCompare(b.suggestion.food.name),
  );

  // Light diversity: cap near-identical macro profiles.
  const out: FoodSuggestion[] = [];
  const used: Record<MacroProfile, number> = { protein: 0, carb: 0, fat: 0, balanced: 0 };
  for (const c of candidates) {
    if (out.length >= count) break;
    if (used[c.profile] >= MAX_PER_PROFILE) continue;
    used[c.profile] += 1;
    out.push(c.suggestion);
  }
  return out;
}
