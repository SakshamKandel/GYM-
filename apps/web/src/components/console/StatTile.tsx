import type { ReactNode } from 'react';

/**
 * Summary metric tile: small dim label on top, a big Oswald tabular number
 * below, optional delta line. `delta.direction` drives a semantic color
 * (up=positive green, down=critical red, flat=dim) — these are SEMANTIC status
 * colors, distinct from the --gt-red accent. Server-component friendly.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
}) {
  const deltaColor =
    delta?.direction === 'up'
      ? '#3fb950'
      : delta?.direction === 'down'
        ? '#ff6b60'
        : 'var(--gt-text-dim)';
  const arrow =
    delta?.direction === 'up' ? '▲' : delta?.direction === 'down' ? '▼' : '–';

  return (
    <div
      className="gt-card"
      style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <span
        style={{
          fontSize: 12,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-dim)',
          fontFamily: 'var(--font-heading)',
        }}
      >
        {label}
      </span>
      <span
        className="gt-numeric"
        style={{ fontSize: 34, lineHeight: 1, color: 'var(--gt-text)' }}
      >
        {value}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 16 }}>
        {delta ? (
          <span
            className="gt-numeric"
            style={{ fontSize: 12, color: deltaColor, display: 'inline-flex', gap: 4 }}
          >
            <span aria-hidden>{arrow}</span>
            {delta.value}
          </span>
        ) : null}
        {hint ? (
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{hint}</span>
        ) : null}
      </div>
    </div>
  );
}
