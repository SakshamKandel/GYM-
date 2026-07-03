/**
 * Flat loading placeholders — NO shimmer, NO pulse (design rule). Just static
 * bars in the border color. Use inside Suspense fallbacks or while a client
 * fetch is pending.
 */

/** A single flat bar. `w` accepts any CSS width (default 100%). */
export function SkeletonBar({ w = '100%', h = 12 }: { w?: number | string; h?: number }) {
  return (
    <div className="gt-skeleton" style={{ width: w, height: h, borderRadius: 6 }} />
  );
}

/**
 * A stack of table-shaped skeleton rows inside a card. `rows` controls the
 * count, `cols` the bars per row. Matches DataTable padding so the swap from
 * skeleton → real table doesn't jump.
 */
export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="gt-card" style={{ padding: 0 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: 'flex',
            gap: 16,
            padding: '14px 16px',
            borderBottom: r === rows - 1 ? 'none' : '1px solid var(--gt-border)',
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} style={{ flex: c === 0 ? 2 : 1 }}>
              <SkeletonBar w={c === 0 ? '70%' : '50%'} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
