import type { CSSProperties, ReactNode } from 'react';

/**
 * Base surface: one step up from the page, hairline border, soft lift, 16px
 * radius (design tokens). `padded` (default true) applies the shared interior
 * gutter; set false when the child manages its own padding (e.g. a DataTable
 * that needs its header flush to the edges).
 *
 * The gutter is --gt-gutter, the same value a CardHeader and a table cell use,
 * so a title, a column header and a cell all sit on ONE left edge instead of
 * the two-pixel stagger they used to.
 */
export function Card({
  children,
  padded = true,
  style,
  className,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={className ? `gt-card ${className}` : 'gt-card'}
      style={{ padding: padded ? 'var(--gt-gutter)' : 0, ...style }}
    >
      {children}
    </div>
  );
}

/**
 * Optional titled header row for a Card — small uppercase label on the left,
 * optional action node on the right, hairline underline. Use inside an
 * unpadded Card or above card content.
 *
 * Fixed 48px so a header with an action button is the same height as one
 * without, and every card in a grid lines up across the row.
 */
export function CardHeader({
  title,
  action,
}: {
  /** Header content — a plain label, or a node when the title needs an
   * inline affordance (e.g. the live-indicator dot). */
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: 48,
        padding: '8px var(--gt-gutter)',
        borderBottom: '1px solid var(--gt-border)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 'var(--gt-fs-micro)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-faint)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        {title}
      </span>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  );
}
