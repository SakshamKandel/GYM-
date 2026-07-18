import type { ReactNode } from 'react';
import {
  areaPath,
  linePath,
  niceCeil,
  seriesToPoints,
  smoothPath,
} from './chart';

/**
 * Area-chart card — pure SVG, no chart library, server-component friendly.
 *
 * Renders a smoothed area (hatch-pattern fill + accent stroke) across `data`,
 * an optional highlighted column band with a floating value pill, and a light
 * baseline. The chart scales responsively via `viewBox`; the fixed user-space
 * below is arbitrary. One accent colour only — the fill/stroke/highlight all
 * draw from --gt-accent, honouring the one-accent rule.
 *
 * A11y: the SVG has role="img" + an aria-label summarising the trend; the
 * series is also emitted as an offscreen <table>-free text summary is skipped
 * to keep it lean, but the label names first/last values. Static (no motion),
 * so it satisfies reduced-motion by construction.
 */
export interface ChartPoint {
  label: string;
  value: number;
}

const VW = 640;
const VH = 240;
const PAD_X = 8;
const PAD_TOP = 28; // room for the floating pill
const PAD_BOTTOM = 26; // room for x labels

export function ChartCard({
  title,
  caption,
  data,
  highlightIndex,
  valueFormat = (v) => String(v),
  action,
  height = 260,
}: {
  title: string;
  caption?: string;
  data: ChartPoint[];
  /** Column to emphasise with a band + floating pill (defaults to the max). */
  highlightIndex?: number;
  valueFormat?: (v: number) => string;
  action?: ReactNode;
  height?: number;
}) {
  const values = data.map((d) => d.value);
  const max = niceCeil(Math.max(0, ...values));
  const plotW = VW - PAD_X * 2;
  const plotH = VH - PAD_TOP - PAD_BOTTOM;

  // Points live inside the plot band (below the pill zone, above the labels).
  const pts = seriesToPoints(values, VW, plotH, 0, max).map((p) => ({
    x: PAD_X + (p.x / VW) * plotW,
    y: PAD_TOP + p.y,
  }));
  const baseline = PAD_TOP + plotH;
  const line = smoothPath(pts);
  const area = areaPath(line, pts, baseline);

  const hi =
    highlightIndex != null && highlightIndex >= 0 && highlightIndex < pts.length
      ? highlightIndex
      : values.length > 0
        ? values.indexOf(Math.max(...values))
        : -1;
  const hiPt = hi >= 0 ? pts[hi] : null;
  const slotW = pts.length > 0 ? plotW / pts.length : 0;

  const first = data[0];
  const last = data[data.length - 1];
  const ariaLabel =
    data.length === 0
      ? `${title}: no data`
      : `${title}: ${valueFormat(first.value)} on ${first.label} to ${valueFormat(last.value)} on ${last.label}, peak ${hi >= 0 ? valueFormat(values[hi]) : '—'}.`;

  return (
    <div
      className="gt-card"
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 16,
              color: 'var(--gt-text)',
            }}
          >
            {title}
          </div>
          {caption ? (
            <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 2 }}>
              {caption}
            </div>
          ) : null}
        </div>
        {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
      </div>

      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <pattern
            id="gt-chart-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--gt-accent-weak)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--gt-accent)"
              strokeWidth="1"
              opacity="0.35"
            />
          </pattern>
        </defs>

        {/* baseline */}
        <line
          x1={PAD_X}
          y1={baseline}
          x2={VW - PAD_X}
          y2={baseline}
          stroke="var(--gt-border-strong)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />

        {/* highlight band behind the peak column */}
        {hiPt ? (
          <rect
            x={hiPt.x - slotW / 2}
            y={PAD_TOP}
            width={slotW}
            height={plotH}
            fill="var(--gt-accent-weak)"
            opacity="0.6"
          />
        ) : null}

        {/* area + line */}
        {area ? <path d={area} fill="url(#gt-chart-hatch)" /> : null}
        {line ? (
          <path
            d={line}
            fill="none"
            stroke="var(--gt-accent)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {/* peak marker + floating pill */}
        {hiPt ? (
          <>
            <circle
              cx={hiPt.x}
              cy={hiPt.y}
              r="4"
              fill="var(--gt-surface)"
              stroke="var(--gt-accent)"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
            <g transform={`translate(${clampPill(hiPt.x)} ${Math.max(4, hiPt.y - 22)})`}>
              <rect
                x="-34"
                y="-14"
                width="68"
                height="22"
                rx="11"
                fill="var(--gt-accent)"
              />
              <text
                x="0"
                y="1"
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--gt-accent-ink)"
                fontSize="13"
                fontFamily="var(--font-numeric)"
                fontWeight="600"
              >
                {valueFormat(values[hi])}
              </text>
            </g>
          </>
        ) : null}
      </svg>

      {/* x-axis labels (HTML, not SVG, so they don't stretch with preserveAspectRatio) */}
      {data.length > 0 ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-numeric)',
            marginTop: -6,
          }}
        >
          {data.map((d, i) => (
            <span
              key={`${d.label}-${i}`}
              style={{ color: i === hi ? 'var(--gt-accent-strong)' : undefined }}
            >
              {d.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Keep the pill horizontally inside the viewBox. */
function clampPill(x: number): number {
  return Math.min(VW - PAD_X - 34, Math.max(PAD_X + 34, x));
}
