import type { ReactNode } from 'react';

/**
 * The smallest possible "what state is this in" — a tinted dot beside a word.
 * Lighter than a Badge, so a table can carry one on every row without the
 * column turning into a wall of pills.
 *
 * A dozen places drew this by hand as an 8px div with a hardcoded colour. This
 * is the one implementation, and it always ships its label: colour alone is not
 * a status anyone can read, and about one man in twelve cannot tell the green
 * one from the red one.
 */
export type StatusDotTone = 'neutral' | 'positive' | 'warning' | 'critical' | 'info' | 'accent';

export function StatusDot({
  tone = 'neutral',
  children,
}: {
  tone?: StatusDotTone;
  /** The label that says what the dot means. Required for a reason. */
  children: ReactNode;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        fontSize: 'var(--gt-fs-meta)',
        color: 'var(--gt-text)',
        whiteSpace: 'nowrap',
      }}
    >
      <span className="gt-status-dot" data-tone={tone === 'neutral' ? undefined : tone} aria-hidden />
      {children}
    </span>
  );
}
