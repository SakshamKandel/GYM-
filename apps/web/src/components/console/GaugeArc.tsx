import type { ReactNode } from 'react';
import { arcLength, arcPath } from './chart';

/**
 * Semicircle gauge — pure SVG, server-component friendly. A single background
 * track arc (180°, left→right) with a value arc drawn on top via
 * `stroke-dasharray` so the fill length is exact math, not many segments.
 *
 * `value` is 0..1. The centred readout shows `display` (or the percentage) with
 * an optional caption below. One accent colour for the fill. Static — no
 * motion, reduced-motion safe by construction.
 *
 * A11y: role="img" + aria-label naming the value; the visible readout is also
 * real text, never color-only.
 */
const VW = 200;
const VH = 118;
const CX = 100;
const CY = 100;
const R = 84;
const STROKE = 16;
const TRACK_LEN = arcLength(R, 180);

export function GaugeArc({
  value,
  display,
  caption,
  tone = 'accent',
}: {
  value: number;
  /** Big centred readout; defaults to the rounded percentage. */
  display?: ReactNode;
  caption?: string;
  /** Fill colour source — accent (default) or a semantic status token. */
  tone?: 'accent' | 'success' | 'danger' | 'warning' | 'info';
}) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const fill =
    tone === 'accent'
      ? 'var(--gt-accent)'
      : tone === 'success'
        ? 'var(--gt-success)'
        : tone === 'danger'
          ? 'var(--gt-danger)'
          : tone === 'warning'
            ? 'var(--gt-warning)'
            : 'var(--gt-info)';
  const track = arcPath(CX, CY, R, 180, 360); // left → right over the top
  const pct = Math.round(v * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        height="auto"
        style={{ maxWidth: 220, display: 'block' }}
        role="img"
        aria-label={`${caption ? `${caption}: ` : ''}${pct}%`}
      >
        <path
          d={track}
          fill="none"
          stroke="var(--gt-surface-hover)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        <path
          d={track}
          fill="none"
          stroke={fill}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${arcLength(R, 180 * v)} ${TRACK_LEN}`}
        />
        <text
          x={CX}
          y={CY - 18}
          textAnchor="middle"
          fill="var(--gt-text)"
          fontSize="30"
          fontFamily="var(--font-numeric)"
          fontWeight="600"
        >
          {display ?? `${pct}%`}
        </text>
      </svg>
      {caption ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--gt-text-dim)',
            marginTop: -4,
            fontFamily: 'var(--font-heading)',
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}
