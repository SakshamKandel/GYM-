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
 *
 * SCALE-UP-PLAN §1.2: `coach_workouts` (silver+) and `coach_diet` (gold+) gate
 * coach-assigned programs. Both ALSO require an active coach assignment,
 * checked separately by the caller — this matrix only expresses the tier
 * floor, not the assignment requirement.
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
  | 'custom_meal_plan'
  | 'coach_workouts'
  | 'coach_diet';

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
  coach_workouts: 'silver',
  coach_diet: 'gold',
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

/**
 * The tier a member ACTUALLY has right now, given a dated subscription.
 *
 * Dated subscriptions live on accounts.tier + accounts.tierExpiresAt. Rather
 * than run a cron that downgrades lapsed rows, the server collapses an expired
 * paid tier to 'starter' at the auth choke point (userForToken / api/me /
 * login) by calling this pure helper. The stored `tier` is never mutated —
 * it stays for history and one-click reactivation.
 *
 * Rules:
 *  - expiresAt null/undefined → no expiry: the stored tier stands (permanent
 *    or free). 'starter' is always permanent regardless of expiry.
 *  - expiresAt strictly in the past (< now) → 'starter'.
 *  - expiresAt exactly === now or in the future → the stored tier stands
 *    (expiry is inclusive of its final instant).
 *
 * `expiresAt` accepts a Date, an ISO string, or null (the shape Drizzle/JSON
 * hands back); an unparseable string is treated as no-expiry (fail OPEN to the
 * stored tier — a bad timestamp must not silently strip a paying member).
 */
export function effectiveTier(
  tier: Tier,
  expiresAt: Date | string | null | undefined,
  now: Date,
): Tier {
  if (tier === 'starter') return 'starter';
  if (expiresAt === null || expiresAt === undefined) return tier;
  const expiryMs = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return tier; // unparseable → fail open to stored tier
  return expiryMs < now.getTime() ? 'starter' : tier;
}
