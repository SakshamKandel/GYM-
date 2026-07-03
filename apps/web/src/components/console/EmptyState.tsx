import type { ReactNode } from 'react';

/**
 * Centered empty-state for a section with no data yet. `title` is the headline,
 * `description` an optional dim line, `action` an optional CTA (e.g. a Button).
 * `icon` is an optional small glyph/node above the title. Server-friendly.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div
      className="gt-card"
      style={{
        padding: '48px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 10,
      }}
    >
      {icon ? (
        <div style={{ color: 'var(--gt-text-dim)', fontSize: 24, lineHeight: 1 }}>
          {icon}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 16,
          color: 'var(--gt-text)',
        }}
      >
        {title}
      </div>
      {description ? (
        <p
          style={{
            margin: 0,
            color: 'var(--gt-text-dim)',
            fontSize: 14,
            maxWidth: '42ch',
          }}
        >
          {description}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}
