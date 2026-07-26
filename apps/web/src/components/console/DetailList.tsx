import type { ReactNode } from 'react';

/**
 * Label-over-value detail pairs — the read-out at the top of a drawer, the
 * summary in a confirmation modal.
 *
 * Half a dozen queues had each written their own `Row({ label, children })`
 * helper for this, all slightly different, so the same order looked one way in
 * Payments and another in Disputes. This is the one implementation, and it is a
 * real <dl>: the label and its value are associated for a screen reader instead
 * of being two unrelated lines that happen to sit near each other.
 *
 * Whitespace separates the pairs; there are no rules and no boxes, because the
 * panel around them already has an edge.
 */
export function DetailList({
  columns = 1,
  children,
}: {
  /** 2 puts short pairs side by side; collapses to 1 on narrow widths. */
  columns?: 1 | 2;
  children: ReactNode;
}) {
  return (
    <dl className="gt-dl" data-columns={columns === 2 ? '2' : undefined}>
      {children}
    </dl>
  );
}

/**
 * One label + value pair. `span` makes a pair take the full width inside a
 * two-column {@link DetailList} — for an address or a note, which reads badly
 * in a half-width column.
 */
export function DetailRow({
  label,
  children,
  span = false,
}: {
  label: string;
  children: ReactNode;
  span?: boolean;
}) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : undefined}>
      <dt className="gt-dt">{label}</dt>
      <dd className="gt-dd">{children}</dd>
    </div>
  );
}
