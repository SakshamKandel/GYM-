import type { GoalType, Tier } from '../types';

/**
 * The Greece Maharjan Method — the tier catalog and the adaptive coaching
 * engine that IS this product. Pure logic, no I/O (CLAUDE.md rule 10).
 *
 * - GM_TIERS: what each plan sells, in ladder order.
 * - gmWeeklyAdjustment: once a week, compare the user's REAL weight trend to
 *   the GM band for their goal and nudge calories toward it.
 * - gmPhaseForWeek: 4-week periodization (3 on, 1 recover).
 */

export const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

export interface GmTier {
  tier: Tier;
  name: string;
  tagline: string;
  /** Placeholder pricing until store products exist. 0 = free. */
  pricePerMonthNpr: number;
  /** What this tier ADDS on top of the tier below it (plain language). */
  features: string[];
}

/** Tier catalog — mirrors Feature Blueprint §05 exactly. */
export const GM_TIERS: GmTier[] = [
  {
    tier: 'starter',
    name: 'Starter',
    tagline: 'Get moving, free forever',
    pricePerMonthNpr: 0,
    features: ['Workout logger', 'Weight tracking & trend', '1 starter plan'],
  },
  {
    tier: 'silver',
    name: 'Silver',
    tagline: 'The full tracking system',
    pricePerMonthNpr: 999,
    features: [
      'Full kcal & macro tracker',
      'GM food suggestions',
      'All standard training programs',
      'Progress photos',
      'No ads',
      'Coach-assigned workouts',
    ],
  },
  {
    tier: 'gold',
    name: 'Gold',
    tagline: 'The GM Method — it adapts to you',
    pricePerMonthNpr: 1999,
    features: [
      "Greece's signature specialized plans",
      'Adaptive progression — targets adjust to your weekly trend',
      'Meal plans & diet-break weeks',
      'Monthly plan refresh',
      'Coach diet plans',
    ],
  },
  {
    tier: 'elite',
    name: 'Elite',
    tagline: 'Coached by Greece himself',
    pricePerMonthNpr: 4999,
    features: [
      'Everything in Gold',
      '1-on-1 coach chat',
      'Video form checks',
      'Custom meal plan',
      'Priority support',
    ],
  },
];

// ── Adaptive weekly calorie engine ─────────────────────────────────────────

export interface GmAdjustmentInput {
  goal: GoalType;
  bodyweightKg: number;
  /** Smoothed trend change per week in kg (negative = losing). */
  trendRatePerWeekKg: number;
  /** What the user is currently eating toward. */
  currentKcal: number;
  /** The original computed target — drift is limited relative to this. */
  baseKcal: number;
}

export interface GmAdjustment {
  newKcal: number;
  changed: boolean;
  reason: string;
}

interface GmBand {
  /** Band bounds as % of bodyweight per week (inclusive). */
  min: number;
  max: number;
  /** kcal nudge when the rate is below min / above max. */
  belowPct: number;
  abovePct: number;
  belowReason: string;
  aboveReason: string;
}

const GM_BANDS: Record<GoalType, GmBand> = {
  // Target −0.4%..−0.8%/wk. Faster loss risks muscle; slower is a stall.
  fat_loss: {
    min: -0.8,
    max: -0.4,
    belowPct: 0.05,
    abovePct: -0.05,
    belowReason: 'Losing faster than the GM band — adding fuel to protect muscle',
    aboveReason: 'Trend is stalling — trimming calories',
  },
  // Target +0.1%..+0.4%/wk. Faster gain is mostly fat; slower leaves gains on the table.
  muscle: {
    min: 0.1,
    max: 0.4,
    belowPct: 0.04,
    abovePct: -0.04,
    belowReason: 'Gaining slower than the GM band — adding fuel to grow',
    aboveReason: 'Gaining faster than the GM band — trimming to keep it lean',
  },
  // Strength: hold roughly steady (−0.2%..+0.3%/wk), small nudges toward the band.
  strength: {
    min: -0.2,
    max: 0.3,
    belowPct: 0.03,
    abovePct: -0.03,
    belowReason: 'Dropping weight can cost strength — adding a little fuel',
    aboveReason: 'Gaining more than strength needs — trimming a little',
  },
};

const KCAL_FLOOR = 1200;
/** newKcal never drifts more than ±20% away from baseKcal. */
const MAX_DRIFT = 0.2;
const ROUND_STEP = 25;

const ON_TRACK = 'On track — stay the course';

function roundToStep(kcal: number): number {
  return Math.round(kcal / ROUND_STEP) * ROUND_STEP;
}

/**
 * The GM adaptive engine: compare the weekly trend (as % of bodyweight) to
 * the goal's band and nudge calories toward it. Clamped to ±20% of baseKcal,
 * rounded to the nearest 25 kcal, never below 1200 kcal.
 */
export function gmWeeklyAdjustment(input: GmAdjustmentInput): GmAdjustment {
  const { goal, bodyweightKg, trendRatePerWeekKg, currentKcal, baseKcal } = input;
  if (bodyweightKg <= 0) {
    return { newKcal: currentKcal, changed: false, reason: 'Not enough data — holding steady' };
  }

  const band = GM_BANDS[goal];
  const ratePct = (trendRatePerWeekKg / bodyweightKg) * 100;

  if (ratePct >= band.min && ratePct <= band.max) {
    return { newKcal: currentKcal, changed: false, reason: ON_TRACK };
  }

  const below = ratePct < band.min;
  const nudged = currentKcal * (1 + (below ? band.belowPct : band.abovePct));
  const clamped = Math.min(
    baseKcal * (1 + MAX_DRIFT),
    Math.max(baseKcal * (1 - MAX_DRIFT), nudged),
  );
  const newKcal = Math.max(KCAL_FLOOR, roundToStep(clamped));

  if (newKcal === currentKcal) {
    return { newKcal, changed: false, reason: 'At the GM safety limit — holding steady' };
  }
  return { newKcal, changed: true, reason: below ? band.belowReason : band.aboveReason };
}

// ── Phase periodization ────────────────────────────────────────────────────

export interface GmPhase {
  kind: 'build' | 'deload' | 'dietBreak';
  label: string;
  note: string;
  volumeMultiplier: number;
}

/**
 * 4-week GM cycle, `week` is 1-based and cycles forever.
 * muscle/strength: 3 build weeks then 1 deload (volume ×0.6).
 * fat_loss: 3 deficit weeks then 1 diet-break week at maintenance.
 */
export function gmPhaseForWeek(week: number, goal: GoalType): GmPhase {
  const pos = ((Math.max(1, Math.floor(week)) - 1) % 4) + 1; // 1..4

  if (goal === 'fat_loss') {
    if (pos === 4) {
      return {
        kind: 'dietBreak',
        label: 'Diet-break week',
        note: 'Diet break — eat at maintenance this week',
        volumeMultiplier: 1,
      };
    }
    return {
      kind: 'build',
      label: `Deficit week ${pos} of 3`,
      note: 'Hold the deficit — protein first, keep moving',
      volumeMultiplier: 1,
    };
  }

  if (pos === 4) {
    return {
      kind: 'deload',
      label: 'Deload week',
      note: 'Deload — move light, recover hard',
      volumeMultiplier: 0.6,
    };
  }
  return {
    kind: 'build',
    label: `Build week ${pos} of 3`,
    note: 'Push it — add a rep or 2.5 kg where you can',
    volumeMultiplier: 1,
  };
}
