/**
 * Flat loading placeholders — NO shimmer, NO pulse (design rule). Just static
 * bars in the border colour.
 *
 * The point of a skeleton is that the page does not move when the data lands,
 * so these mirror the real components' geometry: the table skeleton carries the
 * same header band, the same 52px row rhythm and the same 16px gutter as
 * DataTable, and the tile skeleton matches StatTile's label / number / hint
 * stack. Use inside Suspense fallbacks or while a client fetch is pending.
 */

/**
 * A single flat bar. `w` accepts any CSS width (default 100%). `strong` renders
 * the heavier tone, for a bar standing in for a heading or a primary cell.
 */
export function SkeletonBar({
  w = '100%',
  h = 12,
  strong = false,
}: {
  w?: number | string;
  h?: number;
  strong?: boolean;
}) {
  return (
    <div
      className="gt-skeleton"
      data-weight={strong ? 'strong' : undefined}
      style={{ width: w, height: h, borderRadius: 6 }}
    />
  );
}

/**
 * A table-shaped skeleton. `rows` controls the count, `cols` the bars per row.
 * Carries the `gt-table-card` marker, so nesting it in a Card drops the inner
 * frame exactly as the real table does and the swap gains or loses nothing.
 *
 * `header` (default on) draws the column band, so the loading state and the
 * loaded state are the same height — without it every table grew by 40px the
 * moment its data arrived.
 */
export function SkeletonRows({
  rows = 6,
  cols = 4,
  header = true,
}: {
  rows?: number;
  cols?: number;
  header?: boolean;
}) {
  return (
    <div className="gt-card gt-table-card" style={{ padding: 0, overflow: 'hidden' }}>
      {header ? (
        <div
          aria-hidden
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            height: 40,
            padding: '0 var(--gt-gutter)',
            background: 'var(--gt-surface-sunken)',
            borderBottom: '1px solid var(--gt-border)',
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} style={{ flex: c === 0 ? 2 : 1 }}>
              <SkeletonBar w={c === 0 ? 72 : 54} h={8} />
            </div>
          ))}
        </div>
      ) : null}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            height: 'var(--gt-row-h)',
            padding: '0 var(--gt-gutter)',
            borderBottom: r === rows - 1 ? 'none' : '1px solid var(--gt-border)',
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} style={{ flex: c === 0 ? 2 : 1 }}>
              <SkeletonBar w={c === 0 ? '70%' : '50%'} strong={c === 0} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Stand-in for a row of {@link StatTile}s — same card, same padding, same
 * label / number / hint stack, so the summary strip does not jump when the
 * counts arrive. `count` is how many tiles the real row will render.
 */
export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="gt-card"
          style={{
            padding: 'var(--gt-gutter)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <SkeletonBar w={84} h={10} />
          <SkeletonBar w={110} h={26} strong />
          <SkeletonBar w={64} h={10} />
        </div>
      ))}
    </>
  );
}
