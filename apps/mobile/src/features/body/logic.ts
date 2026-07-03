import type { Href } from 'expo-router';
import type { Measurement, TrendSummary, UnitPref, WeightLog } from '@gym/shared';
import { displayWeight, smoothWeights, trendSummary } from '@gym/shared';
import { addDays, todayIso } from '../../lib/dates';

/** Pure logic for weight trend, strength history and measurements. */

export interface ChartPoint {
  date: string;
  value: number;
}

/**
 * Cast a route string to a typed Href — /body/* routes are new files and the
 * generated typed-routes d.ts may lag behind until the dev server runs.
 */
export function toHref(path: string): Href {
  return path as Href;
}

/**
 * Chart data for the last `windowDays`: raw weigh-ins as dots plus the
 * smoothed trend line. Smoothing runs over the FULL history first so the
 * trend doesn't reset at the window edge. Values in display units.
 */
export function weightChartData(
  weights: WeightLog[],
  unitPref: UnitPref,
  windowDays = 30,
): { raw: ChartPoint[]; trend: ChartPoint[] } {
  const points = smoothWeights(weights.map((w) => ({ date: w.date, kg: w.kg })));
  const cutoff = addDays(todayIso(), -(windowDays - 1));
  const windowed = points.filter((p) => p.date >= cutoff);
  return {
    raw: windowed.map((p) => ({ date: p.date, value: displayWeight(p.kg, unitPref) })),
    trend: windowed.map((p) => ({ date: p.date, value: displayWeight(p.trendKg, unitPref) })),
  };
}

export interface WeightHeadline {
  /** Latest smoothed trend weight in display units, null with no data. */
  trendValue: number | null;
  /** Same trend point in canonical kg — feeds `projectGoal` (blueprint §02). */
  trendKg: number | null;
  summary: TrendSummary;
}

export function weightHeadline(weights: WeightLog[], unitPref: UnitPref): WeightHeadline {
  const points = smoothWeights(weights.map((w) => ({ date: w.date, kg: w.kg })));
  const last = points[points.length - 1];
  return {
    trendValue: last ? displayWeight(last.trendKg, unitPref) : null,
    trendKg: last ? last.trendKg : null,
    summary: trendSummary(points),
  };
}

/** "+0.3 kg/week" — magnitude converted to display units, sign preserved. */
export function rateLabel(summary: TrendSummary, unitPref: UnitPref): string {
  const mag = displayWeight(Math.abs(summary.ratePerWeekKg), unitPref);
  const sign = summary.ratePerWeekKg > 0 ? '+' : summary.ratePerWeekKg < 0 ? '−' : '±';
  return `${sign}${mag.toFixed(1)} ${unitPref}/week`;
}

export function directionIcon(
  direction: TrendSummary['direction'],
): 'trending-up' | 'trending-down' | 'remove' {
  if (direction === 'up') return 'trending-up';
  if (direction === 'down') return 'trending-down';
  return 'remove';
}

/** Trend arrow for a signed delta (0 → flat dash). Adherence-neutral. */
export function deltaIcon(delta: number): 'trending-up' | 'trending-down' | 'remove' {
  if (delta > 0) return 'trending-up';
  if (delta < 0) return 'trending-down';
  return 'remove';
}

/** "+0.3" / "−1.2" / "±0.0" — signed magnitude for delta captions. */
export function signedDelta(delta: number, decimals = 1): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return `${sign}${Math.abs(delta).toFixed(decimals)}`;
}

// ── Measurements ──────────────────────────────────────────────

export type MeasurementKey = 'waistCm' | 'chestCm' | 'armCm' | 'hipCm' | 'thighCm';

export const MEASUREMENT_FIELDS: readonly { key: MeasurementKey; label: string }[] = [
  { key: 'waistCm', label: 'Waist' },
  { key: 'chestCm', label: 'Chest' },
  { key: 'armCm', label: 'Arm' },
  { key: 'hipCm', label: 'Hip' },
  { key: 'thighCm', label: 'Thigh' },
];

/** Sensible prefills when a field has never been measured. */
export const MEASUREMENT_DEFAULTS: Record<MeasurementKey, number> = {
  waistCm: 85,
  chestCm: 100,
  armCm: 35,
  hipCm: 95,
  thighCm: 55,
};

/**
 * Latest known value per field. Entries only carry the fields that changed,
 * so we walk newest-first and keep the first non-null per field.
 */
export function latestMeasurementValues(
  entries: Measurement[],
): Record<MeasurementKey, number | null> {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const out: Record<MeasurementKey, number | null> = {
    waistCm: null,
    chestCm: null,
    armCm: null,
    hipCm: null,
    thighCm: null,
  };
  for (const entry of sorted) {
    for (const { key } of MEASUREMENT_FIELDS) {
      if (out[key] === null && entry[key] !== null) out[key] = entry[key];
    }
  }
  return out;
}

/** "Waist · Chest" — which fields an entry recorded. */
export function measurementFieldsLabel(entry: Measurement): string {
  const names = MEASUREMENT_FIELDS.filter((f) => entry[f.key] !== null).map((f) => f.label);
  return names.length > 0 ? names.join(' · ') : '—';
}

/**
 * Chronological (oldest→newest) series for one measurement field, skipping
 * the entries that didn't record it. Values in cm. Feeds the detail sheet.
 */
export function measurementSeries(entries: Measurement[], key: MeasurementKey): ChartPoint[] {
  return entries
    .filter((e) => e[key] !== null)
    .map((e) => ({ date: e.date, value: e[key] as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Best (max) e1RM in a history series, null when empty. */
export function bestE1Rm(history: { date: string; e1rm: number }[]): number | null {
  if (history.length === 0) return null;
  return Math.max(...history.map((h) => h.e1rm));
}
