import type { ReactNode } from 'react';

/**
 * Summary metric tile: small dim label on top, a big Oswald tabular number
 * below, optional delta line. `delta.direction` drives a SEMANTIC status colour
 * (up=success, down=danger, flat=dim) — distinct from the --gt-accent, which
 * never encodes a trend.
 *
 * An optional `viz` renders a small inline mini-chart on the right (sparkline,
 * bar cluster, or progress ring) — pure SVG, no deps. It draws in neutral ink
 * by default: a strip of four tiles each with an accent sparkline is four
 * accents on one screen, which is no accent at all. Set `accent` on the single
 * tile that answers the page's main question and it takes the colour.
 *
 * Server-component friendly. Backward compatible: without `viz` the tile is
 * unchanged.
 */
type Viz =
  | { kind: 'spark'; data: number[] }
  | { kind: 'bars'; data: number[] }
  | { kind: 'ring'; value: number };

export function StatTile({
  label,
  value,
  hint,
  delta,
  viz,
  live,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  viz?: Viz;
  /** Renders a pulsing "live" dot before the label — for metrics that update
   * in near-real-time (today's order counts, active pipelines). Pure CSS,
   * reduced-motion safe. */
  live?: boolean;
  /**
   * Marks this as THE number on the page. Colours its mini-chart with the
   * accent; use it on one tile per view, or none.
   */
  accent?: boolean;
}) {
  const deltaColor =
    delta?.direction === 'up'
      ? 'var(--gt-success)'
      : delta?.direction === 'down'
        ? 'var(--gt-danger)'
        : 'var(--gt-text-dim)';
  const deltaWord =
    delta?.direction === 'up' ? 'Up' : delta?.direction === 'down' ? 'Down' : 'Flat';

  return (
    <div
      className="gt-card"
      style={{
        padding: 'var(--gt-gutter)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <span
          style={{
            fontSize: 'var(--gt-fs-micro)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-faint)',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {live ? <span className="gt-live-dot" aria-hidden /> : null}
          {label}
        </span>
        <span
          className="gt-numeric"
          style={{
            fontSize: 'var(--gt-fs-display)',
            lineHeight: 1,
            color: 'var(--gt-text)',
            overflowWrap: 'anywhere',
          }}
        >
          {value}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 16 }}>
          {delta ? (
            <span
              className="gt-numeric"
              style={{
                fontSize: 'var(--gt-fs-micro)',
                color: deltaColor,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Arrow direction={delta.direction} />
              <span className="gt-sr-only">{deltaWord}</span>
              {delta.value}
            </span>
          ) : null}
          {hint ? (
            <span style={{ fontSize: 'var(--gt-fs-micro)', color: 'var(--gt-text-dim)' }}>
              {hint}
            </span>
          ) : null}
        </div>
      </div>
      {viz ? (
        <div style={{ flexShrink: 0 }}>
          <MiniViz viz={viz} accent={accent} />
        </div>
      ) : null}
    </div>
  );
}

/** Small solid triangle in the delta's own colour — lighter than the ▲ glyph,
 *  which sat above the baseline and was a different size in every font. */
function Arrow({ direction }: { direction: 'up' | 'down' | 'flat' }) {
  if (direction === 'flat') {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden focusable="false">
        <rect x="0" y="3.25" width="8" height="1.5" rx="0.75" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden focusable="false">
      <path
        d={direction === 'up' ? 'M4 1l3.2 5.4H0.8z' : 'M4 7L0.8 1.6h6.4z'}
        fill="currentColor"
      />
    </svg>
  );
}

function MiniViz({ viz, accent }: { viz: Viz; accent: boolean }) {
  const ink = accent ? 'var(--gt-accent)' : 'var(--gt-text-faint)';

  if (viz.kind === 'ring') {
    const v = Math.min(1, Math.max(0, viz.value));
    const r = 20;
    const c = 2 * Math.PI * r;
    return (
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden focusable="false">
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--gt-surface-hover)" strokeWidth="6" />
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          stroke={ink}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform="rotate(-90 26 26)"
        />
      </svg>
    );
  }

  const data = viz.data.length > 0 ? viz.data : [0];
  const max = Math.max(1, ...data);
  const W = 72;
  const H = 44;

  if (viz.kind === 'bars') {
    const n = data.length;
    const slot = W / n;
    const bw = slot * 0.62;
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
        {data.map((d, i) => {
          const h = (Math.max(0, d) / max) * (H - 4);
          return (
            <rect
              key={i}
              x={slot * i + (slot - bw) / 2}
              y={H - h}
              width={bw}
              height={h}
              rx={2}
              fill={ink}
              opacity={i === n - 1 ? 1 : 0.4}
            />
          );
        })}
      </svg>
    );
  }

  // spark
  const n = data.length;
  const stepX = n === 1 ? 0 : W / (n - 1);
  const pts = data.map((d, i) => {
    const x = n === 1 ? W / 2 : stepX * i;
    const y = H - 3 - (Math.max(0, d) / max) * (H - 6);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <path
        d={pts.join(' ')}
        fill="none"
        stroke={ink}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
