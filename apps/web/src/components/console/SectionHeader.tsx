import type { ReactNode } from 'react';

/**
 * Heading for a block INSIDE a page or a panel — the "Recent activity" over a
 * list, the "Payout details" over a form. Quieter than the page title, louder
 * than body text, with an optional trailing action.
 *
 * Roughly a dozen pages hand-rolled this as a bare uppercase <div>, each
 * picking its own size, colour and bottom margin, so two sections on the same
 * screen rarely looked like siblings. This is the one implementation: micro
 * uppercase in the faint ink, an optional supporting line, and whitespace
 * instead of a rule (the card or table below already draws an edge).
 *
 * Renders a real heading element so the page has an outline a screen reader can
 * navigate; `as` picks the level to keep it in order under the page's h1.
 */
export function SectionHeader({
  title,
  description,
  action,
  as: Tag = 'h2',
}: {
  title: ReactNode;
  /** One line on what this block is for. Optional and usually unnecessary. */
  description?: string;
  /** The single action for this block, e.g. a ghost "Add" button. */
  action?: ReactNode;
  as?: 'h2' | 'h3' | 'h4';
}) {
  return (
    <div style={{ marginBottom: 'var(--gt-space-3)' }}>
      <div className="gt-section-header" style={{ marginBottom: 0 }}>
        <Tag className="gt-section-header-title">{title}</Tag>
        {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
      </div>
      {description ? <p className="gt-section-header-desc">{description}</p> : null}
    </div>
  );
}
