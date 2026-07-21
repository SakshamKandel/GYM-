import type { CSSProperties, ReactNode } from 'react';

/**
 * Base surface: charcoal card one step up from the page, hairline border,
 * 14px radius (design tokens). `padded` (default true) applies interior
 * spacing; set false when the child manages its own padding (e.g. a DataTable
 * that needs its header flush to the edges).
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
      style={{ padding: padded ? 18 : 0, ...style }}
    >
      {children}
    </div>
  );
}

/**
 * Optional titled header row for a Card — small uppercase label on the left,
 * optional action node on the right, hairline underline. Use inside an
 * unpadded Card or above card content.
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
        padding: '14px 18px',
        borderBottom: '1px solid var(--gt-border)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 13,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-dim)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {title}
      </span>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
