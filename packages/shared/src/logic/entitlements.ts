import type { Tier } from '../types';

/**
 * Tier gating goes through THIS function only (CLAUDE.md rule 4).
 * Matrix mirrors the Feature Blueprint §05 exactly:
 *  - STARTER (free): basic logger, weight tracking, limited library, 1 generic plan.
 *  - SILVER: full kcal tracker, food suggestions, all standard programs,
 *    progress photos, no ads. (Entry paid tier — the volume seller.)
 *  - GOLD: signature GM plans, adaptive progression, meal plans, monthly
 *    refresh. (The hero tier — where the coach's methodology is sold.)
 *  - ELITE: everything + 1-on-1 coach chat, video form checks, custom meal
 *    plan, priority support. (Limited seats.)
 */

export type Feature =
  | 'basic_logging'
  | 'weight_tracking'
  | 'full_kcal_tracker'
  | 'food_suggestions'
  | 'standard_programs'
  | 'progress_photos'
  | 'no_ads'
  | 'signature_plans'
  | 'adaptive_progression'
  | 'meal_plans'
  | 'coach_chat'
  | 'form_checks'
  | 'custom_meal_plan';

const TIER_RANK: Record<Tier, number> = { starter: 0, silver: 1, gold: 2, elite: 3 };

const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  basic_logging: 'starter',
  weight_tracking: 'starter',
  full_kcal_tracker: 'silver',
  food_suggestions: 'silver',
  standard_programs: 'silver',
  progress_photos: 'silver',
  no_ads: 'silver',
  signature_plans: 'gold',
  adaptive_progression: 'gold',
  meal_plans: 'gold',
  coach_chat: 'elite',
  form_checks: 'elite',
  custom_meal_plan: 'elite',
};

export function hasEntitlement(user: { tier: Tier }, feature: Feature): boolean {
  return TIER_RANK[user.tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]];
}

export function minTierFor(feature: Feature): Tier {
  return FEATURE_MIN_TIER[feature];
}

export function compareTiers(a: Tier, b: Tier): number {
  return TIER_RANK[a] - TIER_RANK[b];
}
