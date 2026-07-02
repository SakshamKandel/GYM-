import type { PlanWorkout, SetLog } from '@gym/shared';
import { colors } from '@gym/ui-tokens';

/** Pure training logic — no React, no repo. Screens stay thin. */

export const DEFAULT_REST_SEC = 120;
export const DEFAULT_ADHOC_SETS = 3;
/** Sensible cold-start weight when there is zero history (empty bar). */
export const DEFAULT_START_WEIGHT_KG = 20;

export interface RepRange {
  min: number;
  max: number;
  mid: number;
}

/** "8-12" → {8, 12, 10}. "30-60s" → {30, 60, 45}. "5" → {5, 5, 5}. */
export function parseRepRange(range: string | null | undefined): RepRange | null {
  if (!range) return null;
  const pair = /(\d+)\s*-\s*(\d+)/.exec(range);
  if (pair) {
    const min = Number(pair[1]);
    const max = Number(pair[2]);
    return { min, max, mid: Math.round((min + max) / 2) };
  }
  const single = /(\d+)/.exec(range);
  if (single) {
    const v = Number(single[1]);
    return { min: v, max: v, mid: v };
  }
  return null;
}

/** ~45s of work per set + prescribed rest, rounded to the nearest 5 minutes. */
export function estimateWorkoutMinutes(pw: PlanWorkout): number {
  const totalSec = pw.exercises.reduce((sum, e) => sum + e.sets * (45 + e.restSec), 0);
  return Math.max(5, Math.round(totalSec / 60 / 5) * 5);
}

/** 754 → "12:34"; 3765 → "1:02:45". Tabular-friendly clock string. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  return `${m}:${sec}`;
}

/** Weight for display: strip trailing ".0", keep one decimal otherwise. */
export function formatWeightNumber(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function totalVolumeKg(sets: SetLog[]): number {
  return sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
}

/** Standard plate colors mapped to design tokens (25 red · 20 blue · 15 yellow · 10 green · 5 white · small dims). */
export function plateColor(kg: number): string {
  if (kg >= 25) return colors.accent;
  if (kg >= 20) return colors.blue;
  if (kg >= 15) return colors.fat;
  if (kg >= 10) return colors.success;
  if (kg >= 5) return colors.text;
  if (kg >= 2.5) return colors.textDim;
  return colors.textFaint;
}

interface Completable {
  loggedSets: unknown[];
  targetSets: number;
}

/**
 * Next exercise still short of its target sets, scanning forward from
 * `from` and wrapping. Stays at `from` when everything is complete.
 */
export function nextIncompleteIndex(list: Completable[], from: number): number {
  const n = list.length;
  if (n === 0) return 0;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    const e = list[i];
    if (e && e.loggedSets.length < e.targetSets) return i;
  }
  return from;
}

export interface PrefillInput {
  /** Sets logged for this exercise in the CURRENT session. */
  sessionSets: SetLog[];
  /** Sets from the most recent previous session of this exercise. */
  lastSets: SetLog[];
  repRange: string | null;
}

/**
 * Editor prefill: last set logged this session → matching set from last
 * session → plan default (empty bar × mid rep-range).
 */
export function prefillFor(input: PrefillInput): { weightKg: number; reps: number } {
  const lastHere = input.sessionSets[input.sessionSets.length - 1];
  if (lastHere) return { weightKg: lastHere.weightKg, reps: lastHere.reps };
  const nextSetNo = input.sessionSets.length + 1;
  const fromLast =
    input.lastSets.find((s) => s.setNo === nextSetNo) ??
    input.lastSets[input.lastSets.length - 1];
  if (fromLast) return { weightKg: fromLast.weightKg, reps: fromLast.reps };
  const range = parseRepRange(input.repRange);
  return { weightKg: DEFAULT_START_WEIGHT_KG, reps: range?.mid ?? 10 };
}

/** Last-session numbers to beat for a given set number (ghosted in the row). */
export function ghostTarget(lastSets: SetLog[], setNo: number): SetLog | null {
  return lastSets.find((s) => s.setNo === setNo) ?? lastSets[lastSets.length - 1] ?? null;
}
