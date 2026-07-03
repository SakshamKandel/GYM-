import type { ReactNode } from 'react';

/**
 * Horizontal control strip above a table or list — search/filters on the left,
 * actions on the right, wrapping on narrow widths. Both slots optional. Purely
 * layout; server-component friendly (pass client controls as children).
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
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 260px', minWidth: 0 }}>
        {left}
        {children}
      </div>
      {right ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {right}
        </div>
      ) : null}
    </div>
  );
}
