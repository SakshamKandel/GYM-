import type { ReactNode } from 'react';

/**
 * Section header for a console page. Title (Poppins) + optional dim subtitle on
 * the left; a right-aligned action cluster. `action` is the page primary
 * (usually a Button); `secondaryAction` sits just before it (e.g. a ghost
 * Export); `filtersAction` renders on a second row under the title for filter
 * chips / segmented controls. All optional — server-component friendly, and
 * backward compatible with the original {title, subtitle, action} shape.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  secondaryAction,
  filtersAction,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  filtersAction?: ReactNode;
}) {
  return (
    <header style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 'var(--gt-fs-h1)',
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
        {action || secondaryAction ? (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            {secondaryAction}
            {action}
          </div>
        ) : null}
      </div>
      {filtersAction ? (
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {filtersAction}
        </div>
      ) : null}
    </header>
  );
}
