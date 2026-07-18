/**
 * Pure chart math for the console dataviz kit — NO chart library, NO deps, NO
 * DOM. Every function is deterministic and side-effect free so the SVG
 * components (ChartCard, GaugeArc) render identically on server and client.
 *
 * All output is in a fixed SVG user-space; components scale via viewBox. Y is
 * flipped for SVG (0 = top), so higher data values map to smaller y.
 */

export interface Pt {
  x: number;
  y: number;
}

/** A rounded "nice" ceiling for an axis so gridlines land on tidy numbers. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const norm = value / pow; // 1..10
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Maps a series of numbers to evenly-spaced points inside a box of `width` ×
 * `height` with `pad` inset on every side. `max` fixes the top of the value
 * axis (defaults to a nice ceiling of the data's max); a flat all-zero series
 * renders along the baseline.
 */
export function seriesToPoints(
  values: readonly number[],
  width: number,
  height: number,
  pad = 0,
  max?: number,
): Pt[] {
  const n = values.length;
  if (n === 0) return [];
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const top = max ?? niceCeil(Math.max(0, ...values));
  const denom = top <= 0 ? 1 : top;
  const stepX = n === 1 ? 0 : innerW / (n - 1);
  return values.map((v, i) => {
    const x = pad + (n === 1 ? innerW / 2 : stepX * i);
    const ratio = Math.min(1, Math.max(0, v / denom));
    const y = pad + innerH - ratio * innerH;
    return { x, y };
  });
}

/** A straight-segment polyline `d` string through the given points. */
export function linePath(points: readonly Pt[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`)
    .join(' ');
}

/**
 * A smooth (Catmull-Rom → cubic-Bézier) path through the points. Tension 0..1;
 * lower = looser curve. Falls back to a straight move for <3 points.
 */
export function smoothPath(points: readonly Pt[], tension = 0.5): string {
  const n = points.length;
  if (n === 0) return '';
  if (n < 3) return linePath(points);
  const t = clamp01(tension) * 0.5;
  let d = `M${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2.x)} ${round(p2.y)}`;
  }
  return d;
}

/**
 * Closes a line path into a filled area by dropping to the baseline and back.
 * `baseline` is the y of the floor (usually height - pad).
 */
export function areaPath(linePathD: string, points: readonly Pt[], baseline: number): string {
  if (points.length === 0 || linePathD === '') return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePathD} L${round(last.x)} ${round(baseline)} L${round(first.x)} ${round(baseline)} Z`;
}

/** Polar → cartesian for a point on a circle (angle in degrees, 0 = 3 o'clock). */
export function polar(cx: number, cy: number, r: number, angleDeg: number): Pt {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/**
 * SVG arc `d` string from `startDeg` to `endDeg` (degrees, clockwise, 0 = 3
 * o'clock, 90 = 6 o'clock). Used for gauge segments. Angles increase clockwise
 * in SVG's y-down space.
 */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const clockwise = sweep >= 0 ? 1 : 0;
  return `M${round(start.x)} ${round(start.y)} A${round(r)} ${round(r)} 0 ${largeArc} ${clockwise} ${round(end.x)} ${round(end.y)}`;
}

/**
 * Circumference of an arc sweep — for `stroke-dasharray` gauges where a single
 * arc path is filled proportionally instead of drawing many segments.
 */
export function arcLength(r: number, sweepDeg: number): number {
  return (Math.abs(sweepDeg) / 360) * 2 * Math.PI * r;
}

/** Evenly-spaced column x-centres + width for a bar/heat layout. */
export function columnLayout(
  count: number,
  width: number,
  gapRatio = 0.34,
): { centers: number[]; barWidth: number } {
  if (count <= 0) return { centers: [], barWidth: 0 };
  const slot = width / count;
  const barWidth = slot * (1 - gapRatio);
  const centers = Array.from({ length: count }, (_, i) => slot * i + slot / 2);
  return { centers, barWidth };
}

/** 0..1 normalised intensity of `v` against `max` (for heat cells). */
export function intensity(v: number, max: number): number {
  if (max <= 0) return 0;
  return clamp01(v / max);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
