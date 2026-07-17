import type { ReactNode } from 'react';

/**
 * Column spec for <DataTable>. `render(row)` returns the cell content for that
 * row; `header` is the column label; `align` sets text alignment (use 'right'
 * for numeric columns); `width` optionally fixes the column width. `key` must
 * be unique among columns.
 */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
}

/**
 * Dense, dark data table. Hairline row separators, dim uppercase header, subtle
 * hover on rows via the .gt-tr-hover class (in globals — falls back gracefully).
 * Horizontally scrolls inside its own container so the page never scrolls
 * sideways. Renders <empty> (or a default line) when `rows` is empty.
 *
 * Server-component friendly: pass plain data + render fns. `rowKey` derives a
 * stable React key per row; `onRowClick` (client pages only) makes rows
 * clickable — omit it in server components.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  rowAriaLabel,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /**
   * Per-row accessible name for clickable rows, e.g. `(r) => `Open ${r.email}``.
   * When omitted the row exposes NO aria-label, so its accessible name is
   * computed from the cell text (name-from-content) — rows stay distinguishable
   * to screen-reader users instead of all announcing an identical generic
   * label. Pass this to give a shorter, purpose-built name when the cell text
   * is noisy.
   */
  rowAriaLabel?: (row: T) => string;
}) {
  return (
    <div
      className="gt-card"
      style={{ padding: 0, overflowX: 'auto', width: '100%' }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 14,
        }}
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align ?? 'left',
                  padding: '12px 16px',
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  borderBottom: '1px solid var(--gt-border)',
                  width: c.width,
                  whiteSpace: 'nowrap',
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                  color: 'var(--gt-text-dim)',
                  fontSize: 14,
                }}
              >
                {empty ?? 'Nothing here yet.'}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick ? rowAriaLabel?.(row) : undefined}
                className="gt-tr"
                style={{
                  cursor: onRowClick ? 'pointer' : 'default',
                  borderBottom:
                    i === rows.length - 1 ? 'none' : '1px solid var(--gt-border)',
                }}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      textAlign: c.align ?? 'left',
                      padding: '12px 16px',
                      color: 'var(--gt-text)',
                      verticalAlign: 'middle',
                    }}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
