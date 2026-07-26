import type { CSSProperties, ReactNode } from 'react';

/**
 * Small square thumbnail for a table cell (avatar, meal photo, gym photo).
 * Rounded, hairline-bordered, object-fit cover; falls back to an initials/glyph
 * chip when `src` is absent so ragged image data never breaks the row rhythm.
 * Uses a plain <img> (Cloudinary URLs are already sized) — no next/image needed.
 */
export function TableThumb({
  src,
  alt = '',
  size = 36,
  fallback,
}: {
  src?: string | null;
  alt?: string;
  size?: number;
  fallback?: ReactNode;
}) {
  const box: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 'var(--gt-radius-sm)',
    flexShrink: 0,
    border: '1px solid var(--gt-border)',
    background: 'var(--gt-surface-sunken)',
    objectFit: 'cover',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--gt-text-faint)',
    fontFamily: 'var(--font-heading)',
    fontSize: Math.round(size * 0.36),
    fontWeight: 600,
    overflow: 'hidden',
  };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} style={box} loading="lazy" />;
  }
  return (
    <span aria-hidden style={box}>
      {fallback ?? (alt ? alt.charAt(0).toUpperCase() : '—')}
    </span>
  );
}

/**
 * Column spec for <DataTable>. `render(row)` returns the cell content for that
 * row; `header` is the column label; `width` optionally fixes the column width.
 * `key` must be unique among columns.
 *
 * `align` still wins wherever it is set, but most columns no longer need it:
 * `numeric` and `actions` right-align themselves, which is the rule they were
 * being set by hand to follow.
 */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /**
   * The column an operator scans first — the name, the email, the order id.
   * Renders in full-strength ink at heading weight, and becomes the row's
   * `<th scope="row">` so a screen reader names every other cell by it. Mark at
   * most one column per table; the first column is assumed when none is marked.
   */
  primary?: boolean;
  /**
   * Counts, money, durations. Right-aligned and rendered with tabular figures,
   * so the digits line up down the column instead of drifting with the glyph
   * widths. Money still carries its own currency from the render fn.
   */
  numeric?: boolean;
  /**
   * A row's action cluster. Right-aligned, never wraps, and sits at 82% opacity
   * until the row is hovered or something inside it takes focus — secondary
   * actions stay quiet until they are wanted.
   */
  actions?: boolean;
  /**
   * Keeps the header label for screen readers but hides it visually. For an
   * actions column, where "Actions" over a row of buttons is noise.
   */
  headerHidden?: boolean;
}

/**
 * Is this event coming from a control INSIDE the row (a link, a button, an
 * input) rather than from the row itself? A clickable row that also carries a
 * member link would otherwise do both things at once — navigate to the member
 * AND open the row's drawer — so the innermost control wins.
 */
function fromNestedControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('a,button,input,select,textarea') !== null;
}

/** Right for numbers and action clusters, left otherwise. `align` overrides. */
function alignOf<T>(c: Column<T>): 'left' | 'right' | 'center' {
  if (c.align) return c.align;
  if (c.numeric || c.actions) return 'right';
  return 'left';
}

/**
 * The console's workhorse table. A quiet uppercase header band, 52px rows on a
 * fixed rhythm (a row holding a chip is the same height as a row holding text,
 * so the eye can track across a long queue), hairline separators, a recessed
 * hover, an accent-washed selected row, and inset focus rings that survive the
 * horizontal scroll container.
 *
 * Column roles carry the alignment rules so no page has to remember them:
 * `primary` marks the column to scan first, `numeric` right-aligns with tabular
 * figures, `actions` right-aligns and keeps the cluster quiet until hover.
 *
 * `stickyHeader` turns the body into its own scroll region with the column
 * names pinned, so a long queue still says what each column is after the first
 * screenful. Opt in per table: it is right for a 200-row queue and wrong for a
 * six-row summary.
 *
 * The root is its own card, which is right standing alone and wrong nested: most
 * queues sit inside `<Card padded={false}><CardHeader/><DataTable/></Card>`, and
 * that drew two borders and two shadows a hairline apart around the same rows.
 * The `gt-table-card` marker lets globals.css drop the inner frame in exactly
 * that case, so the wrapper owns the edge and an unwrapped table is unchanged.
 *
 * Server-component friendly: pass plain data + render fns. `rowKey` derives a
 * stable React key per row; `onRowClick` (client pages only) makes rows
 * clickable — omit it in server components. Cells may contain their own links
 * or buttons: those swallow the row click instead of firing both.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  rowAriaLabel,
  selectedKey,
  stickyHeader,
  maxHeight,
  stickyTop,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  /** Headline for the empty table, e.g. "No orders today". */
  emptyTitle?: string;
  /** One line saying what would put something here. */
  emptyDescription?: string;
  /** The one thing to do about an empty table (usually a Button). */
  emptyAction?: ReactNode;
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
  /**
   * `rowKey` of the row currently open in a drawer. Washes it in the accent and
   * marks its leading edge, so it is obvious which row the panel belongs to.
   */
  selectedKey?: string | null;
  /**
   * Pin the column names while the rows scroll under them. Off by default:
   * making the header stick means the table body becomes its own scroll region
   * (a header cannot stick inside the horizontal-scroll wrapper otherwise), so
   * it is the right call for a long queue and the wrong one for a six-row
   * summary. Turn it on per table.
   */
  stickyHeader?: boolean;
  /** Height the scrolling body is capped at when `stickyHeader` is on. */
  maxHeight?: number | string;
  /** Offset the sticky header sits at inside its scroll region. */
  stickyTop?: number | string;
  /** Names the table for screen readers when no visible heading does. */
  caption?: string;
}) {
  const sticky = stickyHeader === true && rows.length > 0;
  // No column claimed the primary role, so the first one gets it — that is what
  // every table in the console already meant by putting it first.
  const primaryIndex = Math.max(
    0,
    columns.findIndex((c) => c.primary),
  );
  // The sticky offset travels as a custom property so the rule that uses it can
  // live in the stylesheet (where :hover and sticky belong) while the value
  // stays a prop.
  const tableStyle: CSSProperties & Record<string, string | number> = { fontSize: 14 };
  if (stickyTop != null) {
    tableStyle['--gt-sticky-top'] =
      typeof stickyTop === 'number' ? `${stickyTop}px` : stickyTop;
  } else if (sticky) {
    tableStyle['--gt-sticky-top'] = '0px';
  }

  return (
    <div
      className="gt-card gt-table-card"
      style={{
        padding: 0,
        overflowX: 'auto',
        width: '100%',
        ...(sticky
          ? {
              overflowY: 'auto',
              maxHeight:
                typeof maxHeight === 'number'
                  ? maxHeight
                  : (maxHeight ?? 'min(70vh, 720px)'),
            }
          : null),
      }}
    >
      <table
        className="gt-table"
        data-sticky-header={sticky ? 'true' : undefined}
        style={tableStyle}
      >
        {caption ? <caption className="gt-sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="gt-th"
                style={{ textAlign: alignOf(c), width: c.width }}
              >
                {c.headerHidden ? <span className="gt-sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="gt-table-empty">
                <TableEmpty
                  empty={empty}
                  title={emptyTitle}
                  description={emptyDescription}
                  action={emptyAction}
                />
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const key = rowKey(row, i);
              const selected = selectedKey != null && selectedKey === key;
              return (
                <tr
                  key={key}
                  onClick={
                    onRowClick
                      ? (e) => {
                          if (fromNestedControl(e.target)) return;
                          onRowClick(row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          // Enter on a focused link inside the row belongs to the
                          // link, not to the row.
                          if (fromNestedControl(e.target)) return;
                          e.preventDefault();
                          onRowClick(row);
                        }
                      : undefined
                  }
                  role={onRowClick ? 'button' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? rowAriaLabel?.(row) : undefined}
                  aria-current={selected ? 'true' : undefined}
                  className="gt-tr"
                  data-clickable={onRowClick ? 'true' : undefined}
                  data-selected={selected ? 'true' : undefined}
                  style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  {columns.map((c, ci) => {
                    const className = c.numeric ? 'gt-td gt-tabular' : 'gt-td';
                    const cellStyle: CSSProperties = { textAlign: alignOf(c) };
                    const emphasise = ci === primaryIndex ? 'true' : undefined;
                    // Only a column that ASKED to be the primary one becomes a
                    // row header; the leading column still gets the emphasis,
                    // because that is where every one of these tables already
                    // puts the thing you look for.
                    if (c.primary) {
                      return (
                        <th
                          key={c.key}
                          scope="row"
                          className={className}
                          data-primary="true"
                          style={cellStyle}
                        >
                          {c.render(row)}
                        </th>
                      );
                    }
                    return (
                      <td
                        key={c.key}
                        className={className}
                        data-primary={emphasise}
                        data-actions={c.actions ? 'true' : undefined}
                        style={cellStyle}
                      >
                        {c.render(row)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What a table says when it has nothing to show. A headline an operator can
 * read at a glance, an optional line telling them what would fill it, and an
 * optional single action. Falls back to the legacy `empty` node so every page
 * that passes a plain sentence keeps working — a string is promoted to the
 * headline rather than being left as grey filler.
 */
function TableEmpty({
  empty,
  title,
  description,
  action,
}: {
  empty?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const headline = title ?? (typeof empty === 'string' ? empty : null);
  if (headline === null && empty != null) {
    return <div style={{ color: 'var(--gt-text-dim)', fontSize: 14 }}>{empty}</div>;
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        margin: '0 auto',
        maxWidth: '46ch',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 15,
          color: 'var(--gt-text)',
        }}
      >
        {headline ?? 'Nothing here yet'}
      </span>
      {description ? (
        <span style={{ fontSize: 14, color: 'var(--gt-text-dim)', lineHeight: 1.45 }}>
          {description}
        </span>
      ) : null}
      {action ? <div style={{ marginTop: 10 }}>{action}</div> : null}
    </div>
  );
}
