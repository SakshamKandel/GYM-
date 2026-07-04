import type { SetLog, WorkoutLog } from '@gym/shared';

/** Pure helpers for the workout history browser. */

export interface WorkoutStats {
  volumeKg: number;
  setCount: number;
  prCount: number;
}

export function statsOfSets(sets: SetLog[]): WorkoutStats {
  return {
    volumeKg: Math.round(sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0)),
    setCount: sets.length,
    prCount: sets.filter((s) => s.isPr).length,
  };
}

export interface MonthSection {
  /** 'yyyy-mm' */
  key: string;
  /** 'July 2026' */
  label: string;
  /** Newest first, matching the repo's ordering. */
  workouts: WorkoutLog[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const m = Number(key.slice(5, 7));
  return `${MONTHS[m - 1] ?? ''} ${key.slice(0, 4)}`;
}

/** Group newest-first workouts into month sections, preserving order. */
export function groupByMonth(workouts: WorkoutLog[]): MonthSection[] {
  const map = new Map<string, MonthSection>();
  for (const w of workouts) {
    const key = monthKey(w.date);
    const section = map.get(key);
    if (section) section.workouts.push(w);
    else map.set(key, { key, label: monthLabel(key), workouts: [w] });
  }
  return [...map.values()];
}

/** Sum of a month's session volumes, or null while any session is still loading. */
export function monthTonnageKg(
  section: MonthSection,
  stats: Readonly<Record<string, WorkoutStats>>,
): number | null {
  let total = 0;
  for (const w of section.workouts) {
    const s = stats[w.id];
    if (!s) return null;
    total += s.volumeKg;
  }
  return total;
}

export interface ExerciseGroup {
  exerciseId: string;
  exerciseName: string;
  sets: SetLog[];
}

/** Sets grouped by exercise, in first-logged order. */
export function groupByExercise(sets: SetLog[]): ExerciseGroup[] {
  const map = new Map<string, ExerciseGroup>();
  for (const s of sets) {
    const g = map.get(s.exerciseId);
    if (g) g.sets.push(s);
    else map.set(s.exerciseId, { exerciseId: s.exerciseId, exerciseName: s.exerciseName, sets: [s] });
  }
  return [...map.values()];
}

export interface VsLast {
  /** This session's volume minus the previous session's, kg. */
  deltaVolumeKg: number;
  /** Heaviest set minus the previous session's heaviest, kg. */
  deltaBestKg: number;
}

export function compareSets(current: SetLog[], previous: SetLog[]): VsLast {
  const vol = (sets: SetLog[]): number => sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
  const best = (sets: SetLog[]): number => sets.reduce((max, s) => Math.max(max, s.weightKg), 0);
  return {
    deltaVolumeKg: vol(current) - vol(previous),
    deltaBestKg: best(current) - best(previous),
  };
}

/** 12540 → '12.5K', 8450 → '8450' (mirrors the home dashboard's compact style). */
export function formatCompact(n: number): string {
  if (n >= 10_000) {
    const k = Math.round(n / 100) / 10;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return String(Math.round(n));
}

/** Weight for display: strip trailing '.0', keep one decimal otherwise. */
export function formatWeightNumber(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** '48 min' / '1 h 05 min'; null when the duration is unknown. */
export function minutesLabel(durationSec: number | null): string | null {
  if (durationSec === null || durationSec <= 0) return null;
  const totalMin = Math.max(1, Math.round(durationSec / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

/** m:ss (or h:mm:ss) — same clock the workout recap shows. */
export function clockLabel(totalSec: number | null): string {
  const s = Math.max(0, Math.floor(totalSec ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  return `${m}:${sec}`;
}

/** '▲ +120 kg' / '▼ -2.5 kg' / 'even' — quiet, factual. Takes display-unit deltas. */
export function deltaLabel(delta: number, unit: string): string {
  const r = Math.round(delta * 10) / 10;
  if (r === 0) return 'even';
  const arrow = r > 0 ? '▲' : '▼';
  const sign = r > 0 ? '+' : '-';
  return `${arrow} ${sign}${formatWeightNumber(Math.abs(r))} ${unit}`;
}

/** The per-exercise compare line for the session detail screen. */
export function vsLastLine(volumeDelta: number, bestDelta: number, unit: string): string {
  return `vs last time: volume ${deltaLabel(volumeDelta, unit)} · top set ${deltaLabel(bestDelta, unit)}`;
}
