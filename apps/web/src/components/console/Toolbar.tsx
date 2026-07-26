import type { ReactNode } from 'react';

/**
 * Horizontal control strip above a table or list — search/filters on the left,
 * actions on the right, wrapping on narrow widths. Both slots optional. Purely
 * layout; server-component friendly (pass client controls as children).
 *
 * `align: center` on a wrapped row leaves half-height gaps between the two
 * lines, so the strip stretches its slots instead and lets each control keep
 * its own height. Nothing here draws a border: the table below it already has
 * an edge, and a second one a few pixels above reads as a seam.
 */
export function Toolbar({
  left,
  right,
  children,
}: {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--gt-space-3)',
        marginBottom: 'var(--gt-space-4)',
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--gt-space-2)',
          flex: '1 1 260px',
          minWidth: 0,
          flexWrap: 'wrap',
        }}
      >
        {left}
        {children}
      </div>
      {right ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--gt-space-2)',
            flexShrink: 0,
          }}
        >
          {right}
        </div>
      ) : null}
    </div>
  );
}
