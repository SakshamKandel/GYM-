/**
 * Auto-progression engine — double progression + RPE. Pure, no I/O, no Date.now()
 * (CLAUDE.md rule 10). Suggests load/rep targets only; NEVER changes exercise selection.
 *
 * Rules, evaluated in order against the most recent session:
 *  1. Stall  — 3+ consecutive sessions with no e1RM improvement → deload ~10%.
 *  2. Increase — every working set at/above the top of the rep range AND avg RPE <= 8
 *     → add `incrementKg` (default +2.5 kg).
 *  3. Hold — missed the bottom of the rep range OR avg RPE >= 9.5 → same weight.
 *  4. Default hold — mid-range → same weight, add reps first.
 * When every RPE is null, the RPE conditions pass for increase and fail for hold.
 * Bodyweight work (top weight 0) progresses reps instead of load — e1RM is
 * meaningless at 0 kg, so the stall rule is skipped for it.
 */

import { displayWeight, unitLabel } from './units';
import type { UnitPref } from '../types';

export interface ProgressionSet {
  weightKg: number;
  reps: number;
  rpe: number | null;
}

/** One workout's working sets for a single exercise. Caller pre-filters warmups. */
export interface ProgressionSession {
  date: string; // ISO date
  sets: ProgressionSet[];
}

export interface ProgressionInput {
  exerciseId: string;
  exerciseName: string;
  /** Oldest first, most recent LAST (defensively re-sorted by date). */
  sessions: ProgressionSession[];
  repRangeMin?: number; // default 8
  repRangeMax?: number; // default 12
  incrementKg?: number; // default 2.5
  /** Formats reason strings only — targetWeightKg stays canonical kg. */
  unitPref?: UnitPref; // default 'kg'
}

export type ProgressionAction = 'increase' | 'hold' | 'deload';

export interface ProgressionResult {
  exerciseId: string;
  exerciseName: string;
  action: ProgressionAction;
  /** Canonical kg. Convert at the display edge only. */
  targetWeightKg: number;
  targetRepsMin: number;
  targetRepsMax: number;
  /** Short human-readable explanation, e.g. "Hit 3x12 @ RPE 7 last time — +2.5 kg". */
  reason: string;
}

const DEFAULT_REP_MIN = 8;
const DEFAULT_REP_MAX = 12;
const DEFAULT_INCREMENT_KG = 2.5;
/** Average RPE at/below which a top-of-range session earns a weight increase. */
const RPE_INCREASE_CEILING = 8;
/** Average RPE at/above which we hold regardless of reps. */
const RPE_HOLD_FLOOR = 9.5;
/** Minimum consecutive flat-e1RM sessions before a deload is suggested. */
const STALL_SESSIONS = 3;
const DELOAD_FACTOR = 0.9;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtWeight(kg: number, pref: UnitPref): string {
  // displayWeight rounds kg to 1 decimal, which would misreport microplate
  // increments like 1.25 kg — keep 2 decimals for kg, convert for lb.
  const value = pref === 'kg' ? round2(kg) : displayWeight(kg, pref);
  return `${value} ${unitLabel(pref)}`;
}

function fmtRpe(avg: number): string {
  return `${Math.round(avg * 10) / 10}`;
}

/** Mean of non-null RPEs, or null when the session logged no RPE at all. */
function averageRpe(sets: ProgressionSet[]): number | null {
  const rpes = sets.map((s) => s.rpe).filter((r): r is number => r !== null);
  if (rpes.length === 0) return null;
  return rpes.reduce((a, b) => a + b, 0) / rpes.length;
}

/**
 * Uncapped Epley effort score, for stall detection only. pr.ts's epley1Rm caps
 * reps at 12 (right for PR estimates — e1RM degrades past 12), but a capped
 * score is flat while a member adds reps above the cap, so every 12+-rep range
 * (Face Pull 12–15, Side Laterals 15–20, …) would look permanently stalled and
 * trigger a spurious deload. Stall detection only compares sessions against
 * each other, so the uncapped formula keeps rep-over-rep progress visible at
 * any range while staying identical in shape below the cap.
 */
function effortScore(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  return weightKg * (1 + reps / 30);
}

/**
 * Length of the trailing stall: the largest window of most recent sessions (>= 3)
 * in which no session improved on the e1RM of the earliest session in the window.
 * Returns 0 when there is no stall.
 */
function stallLength(sessionE1Rms: number[]): number {
  for (let w = sessionE1Rms.length; w >= STALL_SESSIONS; w--) {
    const baseline = sessionE1Rms[sessionE1Rms.length - w];
    const rest = sessionE1Rms.slice(sessionE1Rms.length - w + 1);
    if (rest.every((v) => v <= baseline)) return w;
  }
  return 0;
}

/**
 * Suggest the next load/rep target for one exercise from its recent session history.
 * Returns null when there is no usable history.
 */
export function suggestProgression(input: ProgressionInput): ProgressionResult | null {
  const repMin = Math.max(1, Math.round(input.repRangeMin ?? DEFAULT_REP_MIN));
  const repMax = Math.max(repMin, Math.round(input.repRangeMax ?? DEFAULT_REP_MAX));
  const incrementKg =
    input.incrementKg !== undefined && input.incrementKg > 0 ? input.incrementKg : DEFAULT_INCREMENT_KG;
  const unitPref = input.unitPref ?? 'kg';

  // Drop junk sets and empty sessions; stable-sort so the most recent session is last
  // even when the caller's ordering slips.
  const sessions = input.sessions
    .map((s) => ({ date: s.date, sets: s.sets.filter((x) => x.reps > 0 && x.weightKg >= 0) }))
    .filter((s) => s.sets.length > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (sessions.length === 0) return null;

  const last = sessions[sessions.length - 1];
  const topWeight = Math.max(...last.sets.map((s) => s.weightKg));
  const minReps = Math.min(...last.sets.map((s) => s.reps));
  const avgRpe = averageRpe(last.sets);
  const rangeLabel = `${repMin}–${repMax}`;
  const base = {
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    targetRepsMin: repMin,
    targetRepsMax: repMax,
  };

  // A single session is not enough history to progress from — repeat it as a baseline.
  if (sessions.length === 1) {
    if (topWeight <= 0) {
      return {
        ...base,
        action: 'hold',
        targetWeightKg: 0,
        reason: `Only one session logged — repeat ${rangeLabel} reps at bodyweight to set a baseline`,
      };
    }
    return {
      ...base,
      action: 'hold',
      targetWeightKg: topWeight,
      reason: `Only one session logged — repeat ${fmtWeight(topWeight, unitPref)} x ${rangeLabel} to set a baseline`,
    };
  }

  // Bodyweight movement — progress reps, never load. Skips the stall rule (e1RM is 0).
  if (topWeight <= 0) {
    const allAtTop = last.sets.every((s) => s.reps >= repMax);
    const rpeEasy = avgRpe === null || avgRpe <= RPE_INCREASE_CEILING;
    if (allAtTop && rpeEasy) {
      const nextMin = repMin + 2;
      const nextMax = repMax + 2;
      return {
        ...base,
        action: 'increase',
        targetWeightKg: 0,
        targetRepsMin: nextMin,
        targetRepsMax: nextMax,
        reason: `Hit ${last.sets.length}x${minReps} at bodyweight — aim for ${nextMin}–${nextMax} reps next time`,
      };
    }
    return {
      ...base,
      action: 'hold',
      targetWeightKg: 0,
      reason: `Bodyweight work — build toward ${last.sets.length}x${repMax} before raising the target`,
    };
  }

  // Rule 1 — stall: no e1RM progress across 3+ consecutive sessions → deload ~10%.
  const sessionE1Rms = sessions.map((s) =>
    Math.max(...s.sets.map((x) => effortScore(x.weightKg, x.reps))),
  );
  const stall = stallLength(sessionE1Rms);
  if (stall >= STALL_SESSIONS) {
    const gridded = round2(Math.round((topWeight * DELOAD_FACTOR) / incrementKg) * incrementKg);
    const target = gridded <= 0 || gridded >= topWeight ? round2(topWeight * DELOAD_FACTOR) : gridded;
    return {
      ...base,
      action: 'deload',
      targetWeightKg: target,
      reason: `No e1RM progress in ${stall} sessions — deload ~10% and rebuild`,
    };
  }

  // Rule 2 — increase: every set at/above the top of the range and RPE easy enough.
  const allAtTop = last.sets.every((s) => s.reps >= repMax);
  if (allAtTop && (avgRpe === null || avgRpe <= RPE_INCREASE_CEILING)) {
    const rpePart = avgRpe === null ? '' : ` @ RPE ${fmtRpe(avgRpe)}`;
    return {
      ...base,
      action: 'increase',
      targetWeightKg: round2(topWeight + incrementKg),
      reason: `Hit ${last.sets.length}x${minReps}${rpePart} last time — +${fmtWeight(incrementKg, unitPref)}`,
    };
  }

  // Rule 3 — hold: missed the bottom of the range, or grinding at RPE 9.5+.
  if (last.sets.some((s) => s.reps < repMin)) {
    return {
      ...base,
      action: 'hold',
      targetWeightKg: topWeight,
      reason: `Missed the rep target last time — hold ${fmtWeight(topWeight, unitPref)} and own the ${rangeLabel} range`,
    };
  }
  if (avgRpe !== null && avgRpe >= RPE_HOLD_FLOOR) {
    return {
      ...base,
      action: 'hold',
      targetWeightKg: topWeight,
      reason: `RPE ${fmtRpe(avgRpe)} last time — hold ${fmtWeight(topWeight, unitPref)} and recover before adding weight`,
    };
  }

  // Rule 4 — default hold: mid-range, keep adding reps.
  return {
    ...base,
    action: 'hold',
    targetWeightKg: topWeight,
    reason: `In the ${rangeLabel} range — add reps before adding weight`,
  };
}
