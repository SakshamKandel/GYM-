/** Weight-trend smoothing — pure, unit-tested (CLAUDE.md rule 10). */

export interface DatedWeight {
  date: string; // ISO yyyy-mm-dd
  kg: number;
}

export interface TrendPoint extends DatedWeight {
  trendKg: number;
}

/**
 * Exponentially-weighted moving average over daily weigh-ins
 * (the MacroFactor/Hacker's-Diet approach: daily scale noise is meaningless,
 * the trend line is the truth). alpha = 0.25 ≈ 7-day smoothing.
 */
export function smoothWeights(entries: DatedWeight[], alpha = 0.25): TrendPoint[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendPoint[] = [];
  let trend: number | null = null;
  for (const e of sorted) {
    trend = trend === null ? e.kg : trend + alpha * (e.kg - trend);
    out.push({ ...e, trendKg: Math.round(trend * 100) / 100 });
  }
  return out;
}

export interface TrendSummary {
  direction: 'up' | 'down' | 'flat';
  /** Change in trend weight over the window, kg (signed). */
  deltaKg: number;
  /** kg per week, extrapolated from the window. */
  ratePerWeekKg: number;
}

/**
 * Summarize the last `windowDays` of trend: direction arrow + weekly rate.
 * Flat = |delta| under 0.15 kg across the window (scale noise).
 */
export function trendSummary(points: TrendPoint[], windowDays = 7): TrendSummary {
  if (points.length < 2) return { direction: 'flat', deltaKg: 0, ratePerWeekKg: 0 };
  // Window by date span (last N days), not by point count — sporadic weigh-ins
  // must not stretch the "last N days" arrow across the whole history.
  const cutoff =
    new Date(points[points.length - 1]!.date).getTime() - (windowDays - 1) * 86_400_000;
  const recent = points.filter((p) => new Date(p.date).getTime() >= cutoff);
  if (recent.length < 2) return { direction: 'flat', deltaKg: 0, ratePerWeekKg: 0 };
  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const deltaKg = Math.round((last.trendKg - first.trendKg) * 100) / 100;
  const spanDays = Math.max(
    1,
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000,
  );
  const ratePerWeekKg = Math.round(((deltaKg / spanDays) * 7) * 100) / 100;
  const direction = Math.abs(deltaKg) < 0.15 ? 'flat' : deltaKg > 0 ? 'up' : 'down';
  return { direction, deltaKg, ratePerWeekKg };
}
