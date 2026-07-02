/** PR detection — pure, unit-tested (CLAUDE.md rule 10). */

/**
 * Epley estimated 1-rep max. reps=1 returns the weight itself.
 * Capped at 12 reps — e1RM estimates degrade badly beyond that.
 */
export function epley1Rm(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  const cappedReps = Math.min(reps, 12);
  if (cappedReps === 1) return weightKg;
  return Math.round(weightKg * (1 + cappedReps / 30) * 10) / 10;
}

export interface PrCheckInput {
  weightKg: number;
  reps: number;
  /** Best previous e1RM for this exercise, or null if never performed. */
  previousBestE1Rm: number | null;
  /** Best previous weight at ANY reps, used for the "heaviest ever" check. */
  previousBestWeightKg: number | null;
}

export interface PrResult {
  isPr: boolean;
  kind: 'first' | 'e1rm' | 'weight' | null;
  e1rm: number;
}

/**
 * A set is a PR when:
 *  - it's the first ever set for the exercise (kind 'first' — celebrated quietly), or
 *  - estimated 1RM beats the previous best (kind 'e1rm'), or
 *  - raw weight beats the heaviest ever lifted (kind 'weight').
 * Warm-up junk (reps > 12 or weight 0) never counts as an e1RM PR.
 */
export function checkPr(input: PrCheckInput): PrResult {
  const e1rm = epley1Rm(input.weightKg, input.reps);
  if (input.weightKg <= 0 || input.reps <= 0) return { isPr: false, kind: null, e1rm };

  if (input.previousBestE1Rm === null && input.previousBestWeightKg === null) {
    return { isPr: true, kind: 'first', e1rm };
  }
  if (input.previousBestWeightKg !== null && input.weightKg > input.previousBestWeightKg) {
    return { isPr: true, kind: 'weight', e1rm };
  }
  if (input.previousBestE1Rm !== null && input.reps <= 12 && e1rm > input.previousBestE1Rm) {
    return { isPr: true, kind: 'e1rm', e1rm };
  }
  return { isPr: false, kind: null, e1rm };
}
