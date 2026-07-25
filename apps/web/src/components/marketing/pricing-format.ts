import type { Feature, Tier } from '@gym/shared';
import type { PublicCatalog, PublicRegionCatalog } from '@/lib/publicCatalog';

export type Region = keyof PublicCatalog;

/** `amountMinor` → display string ("Rs 1,999" / "$9.99" / "Free"). */
export function formatPrice(amountMinor: number, currency: string): string {
  if (amountMinor === 0) return 'Free';
  const major = amountMinor / 100;
  if (currency === 'NPR') return `Rs ${major.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return `$${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function priceFor(region: PublicRegionCatalog, tier: string): string {
  if (!region.available) return 'Unavailable';
  const row = region.tiers.find((t) => t.tier === tier);
  return row ? formatPrice(row.amountMinor, region.currency) : 'Unavailable';
}

export const TIER_META = [
  { tier: 'starter', name: 'Starter', blurb: 'Track training, food and progress yourself.' },
  { tier: 'silver', name: 'Silver', blurb: 'A verified coach programs your training.' },
  { tier: 'gold', name: 'Gold', blurb: 'Coached training plus a personal diet plan.' },
  { tier: 'elite', name: 'Elite', blurb: 'Full mentorship. Chat with your coach any time.' },
] as const;

/**
 * Marketing tier ids. `Extract` keeps them provably identical to the tiers the
 * app enforces — if TIER_META ever drifts from @gym/shared, this stops
 * compiling instead of shipping a tier the backend has never heard of.
 */
export type TierId = Extract<Tier, (typeof TIER_META)[number]['tier']>;

/** How the comparison table groups rows, in render order. */
export const BULLET_GROUPS = ['Training', 'Food', 'Progress', 'Human coaching'] as const;
export type BulletGroup = (typeof BULLET_GROUPS)[number];

export interface TierBullet {
  /**
   * The entitlement in @gym/shared that gates this claim. Every bullet must
   * name one, and `minTierFor(feature)` must equal the tier it is listed
   * under — src/lib/marketingClaims.test.ts fails the build otherwise. That is
   * what keeps the site from promising something the app does not unlock.
   */
  feature: Feature;
  /** Used verbatim on the tier cards, the home teaser and the table. */
  label: string;
  group: BulletGroup;
}

/**
 * THE single source of truth for what each tier sells, keyed by the tier that
 * unlocks it (so a tier's list is what it ADDS over the tier below).
 *
 * Deliberately absent:
 *  - Ads. There are none at any tier, so selling "no ads" as a paid perk would
 *    contradict the promise made everywhere else on the site.
 *  - Video form checks. Nothing in the app captures member video.
 *  - Meal plans, diet-break weeks and a custom meal plan. No meal-plan builder
 *    ships; Gold's coach diet plan is the real thing and is listed below. These
 *    two came off this list on the same pass that took them off the mobile
 *    paywall, so both surfaces tell one story.
 *  - Features that are free for everyone (meal ordering, gym discovery,
 *    barcode scan): real, but not something a tier unlocks.
 *
 * The entitlements that backed the three dropped claims were deleted from
 * @gym/shared at the same time, so they cannot quietly come back here.
 */
export const TIER_BULLETS: Record<TierId, readonly TierBullet[]> = {
  starter: [
    { feature: 'basic_logging', label: 'Log workouts offline, sets save instantly', group: 'Training' },
    { feature: 'training_plans_starter', label: 'A starter training plan to follow', group: 'Training' },
    { feature: 'weight_tracking', label: 'Weight and measurements with a smoothed trend', group: 'Progress' },
  ],
  // Order matters: the compact home teaser shows the first few, so each tier
  // leads with the reason someone moves up to it.
  silver: [
    { feature: 'coach_workouts', label: 'A verified coach assigns your workouts', group: 'Human coaching' },
    { feature: 'standard_programs', label: 'Every standard training program', group: 'Training' },
    { feature: 'full_kcal_tracker', label: 'Full calorie and macro tracking', group: 'Food' },
    { feature: 'food_suggestions', label: 'Food suggestions that fit the rest of your day', group: 'Food' },
    { feature: 'progress_photos', label: 'Private progress photos', group: 'Progress' },
  ],
  gold: [
    { feature: 'coach_diet', label: 'A personal diet plan from your coach', group: 'Human coaching' },
    { feature: 'signature_plans', label: 'The signature GM Method plans', group: 'Training' },
    { feature: 'adaptive_progression', label: 'Targets that adapt to your weekly trend', group: 'Training' },
  ],
  elite: [
    { feature: 'coach_chat', label: 'Message your coach any time', group: 'Human coaching' },
    // The app gates the priority-support surface on the same entitlement as
    // coach chat (mobile support.tsx / settings.tsx), so that is its backing.
    // The ordering behind the claim is real: the staff inbox sorts Elite
    // tickets above the rest (apps/web/src/lib/supportThreads.ts).
    { feature: 'coach_chat', label: 'Your support messages get answered first', group: 'Human coaching' },
  ],
};

const TIER_IDS: readonly TierId[] = TIER_META.map((t) => t.tier);

/** Bullets a tier adds, optionally capped for compact surfaces (the teaser). */
export function bulletsFor(tier: TierId, limit?: number): readonly TierBullet[] {
  const list = TIER_BULLETS[tier];
  return limit === undefined ? list : list.slice(0, limit);
}

/** "Everything in Silver" line for a tier card — null for the entry tier. */
export function inheritsFrom(tier: TierId): string | null {
  const i = TIER_IDS.indexOf(tier);
  return i > 0 ? `Everything in ${TIER_META[i - 1].name}` : null;
}

export interface ComparisonRow {
  label: string;
  /** Included per tier, in TIER_META order: [starter, silver, gold, elite]. */
  tiers: [boolean, boolean, boolean, boolean];
}

export interface ComparisonGroup {
  group: BulletGroup;
  rows: ComparisonRow[];
}

/**
 * The comparison table, derived from TIER_BULLETS so it can never disagree
 * with the tier cards: a bullet listed under tier N is included from N upward.
 */
export function comparisonGroups(): ComparisonGroup[] {
  return BULLET_GROUPS.map((group) => ({
    group,
    rows: TIER_IDS.flatMap((tier, tierIndex) =>
      TIER_BULLETS[tier]
        .filter((b) => b.group === group)
        .map((b) => ({
          label: b.label,
          tiers: TIER_IDS.map((_, i) => i >= tierIndex) as [boolean, boolean, boolean, boolean],
        })),
    ),
  })).filter((g) => g.rows.length > 0);
}

/** How many features the comparison table lists — keeps the eyebrow honest. */
export function totalBulletCount(): number {
  return TIER_IDS.reduce((sum, tier) => sum + TIER_BULLETS[tier].length, 0);
}
