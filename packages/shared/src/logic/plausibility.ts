/**
 * Sync-ingest plausibility checks (anti-cheat) — pure, unit-tested
 * (CLAUDE.md rule 10). A workout that trips either bound is marked
 * 'unranked' server-side: it stays in the user's own log/history/streak
 * (design law 4) but is excluded from leaderboards, badges, quests,
 * challenges, and PR-celebration credit.
 */

import { epley1Rm } from './pr';
import { canonicalLift } from './badges';

/** Any single set above this weight is implausible regardless of context. */
export const ABSOLUTE_MAX_WEIGHT_KG = 400;

/** Any single set above this rep count is implausible regardless of context. */
export const ABSOLUTE_MAX_REPS = 100;

/** A big-lift e1RM more than this multiple of bodyweight is implausible. */
export const BODYWEIGHT_MULTIPLE_CAP = 4;

/** A session e1RM more than this multiple of a lift's rolling 90-day best is implausible. */
export const VELOCITY_MULTIPLE_CAP = 1.2;

/**
 * A session e1RM within this many kg of a lift's rolling 90-day best is
 * NEVER flagged by the velocity layer, even if it exceeds the multiple cap.
 * This protects normal novice linear progression (e.g. a standard +10 kg
 * jump on a light lift) from tripping a multiple that only makes sense at
 * heavier weights — the jump must clear BOTH the multiple AND this absolute
 * margin to be flagged.
 */
export const VELOCITY_ABSOLUTE_MARGIN_KG = 15;

/** Velocity check only applies once at least this many prior sessions exist for the lift. */
export const VELOCITY_MIN_PRIOR_SESSIONS = 3;

export interface PlausibilitySet {
  weightKg: number;
  reps: number;
  exerciseId: string;
  exerciseName: string;
}

export interface PlausibilityResult {
  ranked: boolean;
  reason: 'absolute_bounds' | 'velocity' | null;
}

export interface PriorBestE1Rm {
  best: number;
  sessions: number;
}

export interface CheckWorkoutPlausibilityArgs {
  sets: readonly PlausibilitySet[];
  bodyweightKg: number | null;
  /** Rolling 90-day best session-e1RM per canonical lift across ALL prior sessions (ranked + unranked), keyed by exerciseId. */
  priorBestE1Rm: Partial<Record<string, PriorBestE1Rm>>;
}

/**
 * Checks a whole workout's sets against the absolute-bounds layer first
 * (weight/reps hard caps, and bodyweight-relative big-lift cap), then the
 * velocity layer (session e1RM vs. rolling 90-day best per exercise, only
 * once enough prior sessions exist to trust a baseline). Absolute bounds are
 * checked before velocity so the more specific/severe reason wins ties.
 */
export function checkWorkoutPlausibility(args: CheckWorkoutPlausibilityArgs): PlausibilityResult {
  const { sets, bodyweightKg, priorBestE1Rm } = args;

  // ── Layer 1: absolute bounds ──────────────────────────────────────────
  for (const set of sets) {
    if (set.weightKg > ABSOLUTE_MAX_WEIGHT_KG || set.reps > ABSOLUTE_MAX_REPS) {
      return { ranked: false, reason: 'absolute_bounds' };
    }
    if (bodyweightKg !== null && bodyweightKg > 0) {
      const lift = canonicalLift(set.exerciseId, set.exerciseName);
      if (lift) {
        const e1rm = epley1Rm(set.weightKg, set.reps);
        if (e1rm > BODYWEIGHT_MULTIPLE_CAP * bodyweightKg) {
          return { ranked: false, reason: 'absolute_bounds' };
        }
      }
    }
  }

  // ── Layer 2: velocity (per-exercise session-best e1RM vs. rolling best) ─
  const sessionBestByExercise = new Map<string, number>();
  for (const set of sets) {
    const e1rm = epley1Rm(set.weightKg, set.reps);
    const prev = sessionBestByExercise.get(set.exerciseId) ?? 0;
    if (e1rm > prev) sessionBestByExercise.set(set.exerciseId, e1rm);
  }

  for (const [exerciseId, sessionBest] of sessionBestByExercise) {
    const prior = priorBestE1Rm[exerciseId];
    if (!prior || prior.sessions < VELOCITY_MIN_PRIOR_SESSIONS) continue;
    const exceedsMultiple = sessionBest > VELOCITY_MULTIPLE_CAP * prior.best;
    const exceedsAbsoluteMargin = sessionBest > prior.best + VELOCITY_ABSOLUTE_MARGIN_KG;
    if (exceedsMultiple && exceedsAbsoluteMargin) {
      return { ranked: false, reason: 'velocity' };
    }
  }

  return { ranked: true, reason: null };
}
