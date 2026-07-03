/**
 * Flat skeleton bars for loading states (Suspense fallbacks). No shimmer, no
 * pulse — per the design spec, loading is just flat bars in the hairline color.
 */
export function SkeletonBars({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="gt-card"
          style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div className="gt-skeleton" style={{ width: '40%' }} />
          <div className="gt-skeleton" style={{ width: '75%' }} />
        </div>
      ))}
    </div>
  );
}
