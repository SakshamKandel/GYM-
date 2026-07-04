import { weekStartIso, type WorkoutLog } from '@gym/shared';
import type { TaggedSet } from '@gym/shared';

/** Pure logic for the Progress analytics dashboard — no React, no IO. */

/** Window for the consistency heatmap, tonnage bars and stats. */
export const ANALYTICS_WEEKS = 12;
/** Window for the nutrition trend charts and adherence stats. */
export const NUTRITION_DAYS = 14;
/** How far back the "not hit yet" callout looks for recently trained muscles. */
export const NEGLECT_LOOKBACK_WEEKS = 4;

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

/** UTC day-stepping — same arithmetic as the shared weekStartIso, timezone-proof. */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

/** "APR 13" — compact date for chart footers. */
export function monthDay(iso: string): string {
  return `${MONTHS[monthIndex(iso)] ?? ''} ${Number(iso.slice(8, 10))}`;
}

// ── Consistency heatmap ─────────────────────────────────────────

export interface HeatDay {
  date: string;
  done: boolean;
  isToday: boolean;
  /** Days after today render as empty slots. */
  future: boolean;
}

export interface HeatWeek {
  /** Month label shown above the column where a new month starts. */
  monthLabel: string | null;
  /** Monday → Sunday. */
  days: HeatDay[];
}

/**
 * Grid for the last ANALYTICS_WEEKS ISO weeks ending in today's week,
 * one column per week. `workoutDates` are finished-workout dates
 * (duplicates collapse — the cell is binary).
 */
export function buildHeatmap(workoutDates: readonly string[], today: string): HeatWeek[] {
  const done = new Set(workoutDates);
  const currentStart = weekStartIso(today);
  const weeks: HeatWeek[] = [];
  for (let w = 0; w < ANALYTICS_WEEKS; w++) {
    const monday = addDaysIso(currentStart, -7 * (ANALYTICS_WEEKS - 1 - w));
    const days: HeatDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDaysIso(monday, i);
      days.push({ date, done: done.has(date), isToday: date === today, future: date > today });
    }
    weeks.push({ monthLabel: null, days });
  }
  // Label the columns where the month turns over. The first column is labeled
  // too, unless the very next column starts a new month (labels would collide).
  for (let w = 0; w < weeks.length; w++) {
    const wk = weeks[w];
    const first = wk?.days[0];
    if (!wk || !first) continue;
    const month = monthIndex(first.date);
    if (w === 0) {
      const nextFirst = weeks[1]?.days[0];
      if (!nextFirst || monthIndex(nextFirst.date) === month) {
        wk.monthLabel = MONTHS[month] ?? null;
      }
    } else {
      const prevFirst = weeks[w - 1]?.days[0];
      if (prevFirst && monthIndex(prevFirst.date) !== month) {
        wk.monthLabel = MONTHS[month] ?? null;
      }
    }
  }
  return weeks;
}

// ── Overview stats ──────────────────────────────────────────────

/** Mean session length in whole minutes across finished workouts (null = none timed). */
export function avgSessionMinutes(workouts: readonly WorkoutLog[]): number | null {
  const secs = workouts
    .map((w) => w.durationSec)
    .filter((s): s is number => s !== null && s > 0);
  if (secs.length === 0) return null;
  return Math.round(secs.reduce((sum, s) => sum + s, 0) / secs.length / 60);
}

// ── Muscle balance ──────────────────────────────────────────────

/**
 * Muscles the user worked in the `lookbackWeeks` before this week but has
 * not touched (primary or secondary) since the week started. Alphabetical.
 */
export function neglectedMuscles(
  tagged: readonly TaggedSet[],
  weekStart: string,
  lookbackWeeks: number,
): string[] {
  const priorStart = addDaysIso(weekStart, -7 * lookbackWeeks);
  const prior = new Set<string>();
  const thisWeek = new Set<string>();
  for (const s of tagged) {
    const bucket = s.workoutDate >= weekStart ? thisWeek : s.workoutDate >= priorStart ? prior : null;
    if (!bucket) continue;
    if (s.primaryMuscle) bucket.add(s.primaryMuscle);
    for (const m of s.secondaryMuscles) {
      if (m) bucket.add(m);
    }
  }
  return [...prior].filter((m) => !thisWeek.has(m)).sort();
}

/** free-exercise-db names are lowercase — capitalize for display. */
export function muscleLabel(muscle: string): string {
  return muscle.charAt(0).toUpperCase() + muscle.slice(1);
}

/** "12" or "12.5" — hard sets can be fractional (secondaries count 0.5). */
export function fmtSets(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ── Big four ────────────────────────────────────────────────────

export interface Big4Lift {
  key: 'squat' | 'bench' | 'deadlift' | 'ohp';
  label: string;
  /** free-exercise-db id — the exact ids the seed plans program. */
  exerciseId: string;
}

export const BIG4_LIFTS: readonly Big4Lift[] = [
  { key: 'squat', label: 'Squat', exerciseId: 'Barbell_Squat' },
  { key: 'bench', label: 'Bench press', exerciseId: 'Barbell_Bench_Press_-_Medium_Grip' },
  { key: 'deadlift', label: 'Deadlift', exerciseId: 'Barbell_Deadlift' },
  { key: 'ohp', label: 'Overhead press', exerciseId: 'Barbell_Shoulder_Press' },
] as const;

// ── Nutrition ───────────────────────────────────────────────────

/** Mean of days with any water logged; null when none were. */
export function avgWaterMl(waterMls: readonly number[]): number | null {
  const logged = waterMls.filter((ml) => ml > 0);
  if (logged.length === 0) return null;
  return Math.round(logged.reduce((sum, ml) => sum + ml, 0) / logged.length);
}

/** ml → litres with 1 decimal ("2.1"). */
export function litresLabel(ml: number): string {
  return (Math.round(Math.max(0, ml) / 100) / 10).toFixed(1);
}

// ── Number formatting ───────────────────────────────────────────

/** Big chart numbers: 142000 → "142k", 8400 → "8.4k", 950 → "950". */
export function fmtCompact(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n));
}
