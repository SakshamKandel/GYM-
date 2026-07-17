import { SkeletonBar, SkeletonRows } from '@/components/console';

/**
 * Route-level loading fallback for the whole /admin subtree (D9). Before this,
 * navigating between console sections gave zero feedback while the server
 * component streamed. Flat skeletons only — no shimmer/pulse (design rule).
 */
export default function AdminLoading() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <SkeletonBar w={220} h={26} />
        <div style={{ marginTop: 10 }}>
          <SkeletonBar w={360} h={14} />
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="gt-card" style={{ padding: 18 }}>
            <SkeletonBar w={100} h={12} />
            <div style={{ marginTop: 12 }}>
              <SkeletonBar w={70} h={28} />
            </div>
          </div>
        ))}
      </div>
      <SkeletonRows rows={6} cols={4} />
    </div>
  );
}
