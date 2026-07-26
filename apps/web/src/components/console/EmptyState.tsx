import type { ReactNode } from 'react';

/**
 * What a section says when it has nothing to show. An empty state that only
 * says "no data" wastes the one moment an operator is looking for guidance, so
 * this leads with a headline they can read at a glance, follows with one line
 * about what would fill it, and offers at most one action.
 *
 * `title` is the headline, `description` an optional dim line, `action` an
 * optional CTA (e.g. a Button), `icon` an optional glyph above the title —
 * drawn in a soft tinted disc so it reads as an illustration rather than as a
 * stray character. `bare` drops the card frame, for use inside a surface that
 * already has one. Server-friendly.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  bare = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  /** Skip the card frame — the parent already draws one. */
  bare?: boolean;
}) {
  return (
    <div
      className={bare ? undefined : 'gt-card'}
      style={{
        padding: '40px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 8,
      }}
    >
      {icon ? (
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            marginBottom: 4,
            borderRadius: 'var(--gt-radius-pill)',
            background: 'var(--gt-surface-sunken)',
            border: '1px solid var(--gt-border)',
            color: 'var(--gt-text-faint)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          {icon}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 'var(--gt-fs-h2)',
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
            fontSize: 'var(--gt-fs-meta)',
            lineHeight: 1.5,
            maxWidth: '44ch',
          }}
        >
          {description}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 10 }}>{action}</div> : null}
    </div>
  );
}
