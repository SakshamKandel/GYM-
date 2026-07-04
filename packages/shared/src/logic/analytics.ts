/** Training & nutrition analytics — pure math, unit-tested (CLAUDE.md rule 10). */

// ── Date helpers ────────────────────────────────────────────────

/** Add whole days to an ISO yyyy-mm-dd date. UTC arithmetic — timezone-proof. */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO date of the start of the week containing `dateIso` (Monday by default). */
export function weekStartIso(dateIso: string, weekStartsMonday = true): string {
  const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
  const back = weekStartsMonday ? (dow + 6) % 7 : dow;
  return addDaysIso(dateIso, -back);
}

/** Week starts (oldest → newest) for the last `weeks` ISO weeks ending in `todayIso`'s week. */
function lastWeekStarts(weeks: number, todayIso: string): string[] {
  const current = weekStartIso(todayIso);
  const out: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) out.push(addDaysIso(current, -7 * i));
  return out;
}

// ── Weekly tonnage ──────────────────────────────────────────────

export interface TonnageSet {
  workoutDate: string;
  weightKg: number;
  reps: number;
}

export interface WeeklyTonnage {
  weekStartIso: string;
  tonnageKg: number;
  setCount: number;
}

/**
 * Total tonnage (kg × reps) and set count per ISO week for the last `weeks`
 * weeks up to `todayIso`, oldest → newest. Weeks without sets come back
 * zero-filled so charts always get one bar per week.
 */
export function weeklyTonnage(sets: TonnageSet[], weeks: number, todayIso: string): WeeklyTonnage[] {
  const buckets = new Map<string, { tonnageKg: number; setCount: number }>();
  for (const start of lastWeekStarts(weeks, todayIso)) {
    buckets.set(start, { tonnageKg: 0, setCount: 0 });
  }
  for (const s of sets) {
    const b = buckets.get(weekStartIso(s.workoutDate));
    if (!b) continue; // outside the window
    b.tonnageKg += s.weightKg * s.reps;
    b.setCount += 1;
  }
  return [...buckets.entries()].map(([start, b]) => ({
    weekStartIso: start,
    tonnageKg: Math.round(b.tonnageKg),
    setCount: b.setCount,
  }));
}

// ── Weekly hard sets per muscle ─────────────────────────────────

export interface TaggedSet {
  workoutDate: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
}

export interface MuscleSets {
  muscle: string;
  hardSets: number;
}

/**
 * Hard-set volume per muscle for the week starting at `weekStartIsoStr`.
 * A set counts 1.0 toward its primary muscle and 0.5 toward each secondary.
 * Sorted by volume, highest first (ties break alphabetically).
 */
export function weeklySetsPerMuscle(taggedSets: TaggedSet[], weekStartIsoStr: string): MuscleSets[] {
  const weekEnd = addDaysIso(weekStartIsoStr, 6);
  const totals = new Map<string, number>();
  for (const s of taggedSets) {
    if (s.workoutDate < weekStartIsoStr || s.workoutDate > weekEnd) continue;
    if (s.primaryMuscle) totals.set(s.primaryMuscle, (totals.get(s.primaryMuscle) ?? 0) + 1);
    for (const m of s.secondaryMuscles) {
      if (m) totals.set(m, (totals.get(m) ?? 0) + 0.5);
    }
  }
  return [...totals.entries()]
    .map(([muscle, hardSets]) => ({ muscle, hardSets }))
    .sort((a, b) => b.hardSets - a.hardSets || a.muscle.localeCompare(b.muscle));
}

/** Hypertrophy-literature standard: 10–20 hard sets per muscle per week. */
export const MUSCLE_TARGET_BAND = { min: 10, max: 20 } as const;

export type BalanceVerdict = 'low' | 'inRange' | 'high';

/** Where weekly hard-set volume for one muscle sits vs. MUSCLE_TARGET_BAND. */
export function balanceVerdict(hardSets: number): BalanceVerdict {
  if (hardSets < MUSCLE_TARGET_BAND.min) return 'low';
  if (hardSets > MUSCLE_TARGET_BAND.max) return 'high';
  return 'inRange';
}

// ── Muscle groups (free-exercise-db's 17 muscle names) ──────────

export const PUSH_MUSCLES = ['chest', 'shoulders', 'triceps'] as const;

export const PULL_MUSCLES = ['lats', 'middle back', 'biceps', 'traps', 'forearms'] as const;

export const LEG_MUSCLES = [
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'adductors',
  'abductors',
] as const;

export const CORE_MUSCLES = ['abdominals', 'lower back', 'neck'] as const;

/**
 * Push volume ÷ pull volume from a per-muscle breakdown. Muscles outside the
 * push/pull groups are ignored. Null when pull volume is 0 (ratio undefined).
 */
export function pushPullRatio(perMuscle: MuscleSets[]): number | null {
  let push = 0;
  let pull = 0;
  for (const m of perMuscle) {
    if ((PUSH_MUSCLES as readonly string[]).includes(m.muscle)) push += m.hardSets;
    else if ((PULL_MUSCLES as readonly string[]).includes(m.muscle)) pull += m.hardSets;
  }
  if (pull === 0) return null;
  return Math.round((push / pull) * 100) / 100;
}

// ── Consistency ─────────────────────────────────────────────────

export interface ConsistencyStats {
  /** Sessions per ISO week, oldest → newest, zero-filled. */
  perWeek: { weekStartIso: string; sessions: number }[];
  avgPerWeek: number;
  /** avgPerWeek vs. target, as a percentage capped at 100. */
  adherencePct: number;
  /** Session counts by weekday, index 0 = Monday .. 6 = Sunday. */
  dayOfWeekCounts: number[];
}

/**
 * How consistently the user trained over the last `weeks` weeks.
 * `workoutDates` are the dates of finished workouts (duplicates = multiple
 * sessions that day, all counted). Dates outside the window are ignored.
 */
export function consistencyStats(
  workoutDates: string[],
  weeks: number,
  todayIso: string,
  targetPerWeek: number,
): ConsistencyStats {
  const starts = lastWeekStarts(weeks, todayIso);
  const sessions = new Map<string, number>();
  for (const start of starts) sessions.set(start, 0);
  const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const date of workoutDates) {
    const start = weekStartIso(date);
    const count = sessions.get(start);
    if (count === undefined) continue; // outside the window
    sessions.set(start, count + 1);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
    const monIndex = (dow + 6) % 7;
    dayOfWeekCounts[monIndex] = (dayOfWeekCounts[monIndex] ?? 0) + 1;
  }
  const perWeek = starts.map((start) => ({ weekStartIso: start, sessions: sessions.get(start) ?? 0 }));
  const total = perWeek.reduce((sum, w) => sum + w.sessions, 0);
  const avgPerWeek = weeks > 0 ? Math.round((total / weeks) * 100) / 100 : 0;
  const adherencePct =
    targetPerWeek > 0 ? Math.min(100, Math.round((avgPerWeek / targetPerWeek) * 100)) : 0;
  return { perWeek, avgPerWeek, adherencePct, dayOfWeekCounts };
}

// ── Plateau detection ───────────────────────────────────────────

export type PlateauVerdict = 'progressing' | 'plateau' | 'regressing' | 'insufficient';

/**
 * Compare the best of the last 3 points vs. the best of the 3 before them:
 * more than +1% = progressing, less than −1% = regressing, else plateau.
 * Fewer than 6 points is not enough signal to call it.
 */
export function detectPlateau(series: { date: string; value: number }[]): PlateauVerdict {
  if (series.length < 6) return 'insufficient';
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const bestLast = Math.max(...sorted.slice(-3).map((p) => p.value));
  const bestPrior = Math.max(...sorted.slice(-6, -3).map((p) => p.value));
  if (bestPrior <= 0) return bestLast > 0 ? 'progressing' : 'plateau';
  const change = (bestLast - bestPrior) / bestPrior;
  if (change > 0.01) return 'progressing';
  if (change < -0.01) return 'regressing';
  return 'plateau';
}

// ── Nutrition adherence ─────────────────────────────────────────

/** Macro totals for one day. What Repo.getMacrosByDate resolves per date. */
export interface DailyMacros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface KcalAdherence {
  /** Days with any food logged (kcal > 0). */
  daysLogged: number;
  avgKcal: number;
  /** Logged days within ±10% of the target. */
  inTargetDays: number;
  /** inTargetDays as a percentage of daysLogged. */
  adherencePct: number;
}

/**
 * Calorie adherence over a set of days. Zero-kcal days mean nothing was
 * logged, so they are excluded rather than counted as misses.
 */
export function kcalAdherence(byDate: Record<string, DailyMacros>, targetKcal: number): KcalAdherence {
  const logged = Object.values(byDate).filter((d) => d.kcal > 0);
  const daysLogged = logged.length;
  const avgKcal =
    daysLogged > 0 ? Math.round(logged.reduce((sum, d) => sum + d.kcal, 0) / daysLogged) : 0;
  if (daysLogged === 0 || targetKcal <= 0) {
    return { daysLogged, avgKcal, inTargetDays: 0, adherencePct: 0 };
  }
  const inTargetDays = logged.filter((d) => Math.abs(d.kcal - targetKcal) <= targetKcal * 0.1).length;
  const adherencePct = Math.round((inTargetDays / daysLogged) * 100);
  return { daysLogged, avgKcal, inTargetDays, adherencePct };
}

export interface ProteinHitRate {
  /** Days with any food logged (kcal > 0). */
  daysLogged: number;
  /** Logged days at ≥90% of the protein target. */
  hitDays: number;
  /** hitDays as a percentage of daysLogged. */
  hitPct: number;
}

/** Protein hit rate over a set of days, excluding unlogged (zero-kcal) days. */
export function proteinHitRate(
  byDate: Record<string, DailyMacros>,
  targetProtein: number,
): ProteinHitRate {
  const logged = Object.values(byDate).filter((d) => d.kcal > 0);
  const daysLogged = logged.length;
  if (daysLogged === 0 || targetProtein <= 0) return { daysLogged, hitDays: 0, hitPct: 0 };
  const hitDays = logged.filter((d) => d.protein >= targetProtein * 0.9).length;
  const hitPct = Math.round((hitDays / daysLogged) * 100);
  return { daysLogged, hitDays, hitPct };
}
