import type { ReactNode } from 'react';

/**
 * Section header for a console page. Title (Poppins) + optional dim subtitle on
 * the left; an optional action slot (usually a Button) pinned right. Purely
 * presentational — server-component friendly.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 24,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 22,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              margin: '6px 0 0',
              color: 'var(--gt-text-dim)',
              fontSize: 14,
              maxWidth: '60ch',
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </header>
  );
}
