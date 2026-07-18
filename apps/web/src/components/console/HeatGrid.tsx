import { intensity } from './chart';

/**
 * Heat-map grid — CSS grid, no SVG, server-component friendly. Each cell's
 * background is the accent token mixed with the surface via `color-mix` at an
 * intensity proportional to its value, so a single token drives the whole ramp
 * (dark-mode flips automatically).
 *
 * A11y: never color-only — every cell shows its numeric value as text, and the
 * text colour flips to the accent-ink above a legibility threshold. Row/column
 * labels are real headers. `title` names the metric for screen readers via the
 * cell `title` attribute.
 */
export interface HeatRow {
  label: string;
  values: number[];
}

export function HeatGrid({
  columns,
  rows,
  max,
  format = (v) => String(v),
  metricLabel = 'value',
}: {
  columns: string[];
  rows: HeatRow[];
  /** Value that maps to full intensity (defaults to the data max). */
  max?: number;
  format?: (v: number) => string;
  metricLabel?: string;
}) {
  const dataMax =
    max ?? Math.max(1, ...rows.flatMap((r) => r.values.map((v) => Math.max(0, v))));

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <div
        role="table"
        aria-label={`${metricLabel} heat map`}
        style={{
          display: 'grid',
          gridTemplateColumns: `minmax(64px, max-content) repeat(${columns.length}, minmax(40px, 1fr))`,
          gap: 4,
          minWidth: 'min-content',
        }}
      >
        {/* header row */}
        <div role="columnheader" aria-hidden style={{ minWidth: 64 }} />
        {columns.map((c) => (
          <div
            key={c}
            role="columnheader"
            style={{
              fontSize: 11,
              color: 'var(--gt-text-dim)',
              fontFamily: 'var(--font-numeric)',
              textAlign: 'center',
              padding: '0 0 2px',
            }}
          >
            {c}
          </div>
        ))}

        {/* body rows */}
        {rows.map((row) => (
          <Row
            key={row.label}
            row={row}
            dataMax={dataMax}
            format={format}
            metricLabel={metricLabel}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  row,
  dataMax,
  format,
  metricLabel,
}: {
  row: HeatRow;
  dataMax: number;
  format: (v: number) => string;
  metricLabel: string;
}) {
  return (
    <div role="row" style={{ display: 'contents' }}>
      <div
        role="rowheader"
        style={{
          fontSize: 12,
          color: 'var(--gt-text-dim)',
          fontFamily: 'var(--font-heading)',
          display: 'flex',
          alignItems: 'center',
          paddingRight: 6,
          whiteSpace: 'nowrap',
        }}
      >
        {row.label}
      </div>
      {row.values.map((v, i) => {
        const t = intensity(v, dataMax);
        // color-mix: accent at (12%..100%) over surface; text flips high-end.
        const pct = Math.round(12 + t * 88);
        const strong = t > 0.55;
        return (
          <div
            key={i}
            role="cell"
            title={`${row.label} · ${format(v)} ${metricLabel}`}
            style={{
              minHeight: 40,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontFamily: 'var(--font-numeric)',
              fontVariantNumeric: 'tabular-nums',
              background: `color-mix(in srgb, var(--gt-accent) ${pct}%, var(--gt-surface))`,
              color: strong ? 'var(--gt-accent-ink)' : 'var(--gt-text-dim)',
              border: '1px solid var(--gt-border)',
            }}
          >
            {format(v)}
          </div>
        );
      })}
    </div>
  );
}
