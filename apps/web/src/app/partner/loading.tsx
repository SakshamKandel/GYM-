import { SkeletonBar, SkeletonRows, SkeletonTiles } from '@/components/console';

/**
 * Route-level loading fallback for the whole /partner subtree, matching the one
 * admin and coach already had.
 *
 * Without it every partner navigation froze the page the kitchen was already
 * looking at until the next page's queries all came back, which on the Today
 * board is nine round trips in a row. Now the shell and this skeleton appear at
 * once and the board fills in behind it. Flat bars only, no shimmer or pulse
 * (console design rule).
 */
export default function PartnerLoading() {
  return (
    <div style={{ width: '100%', maxWidth: 1240 }}>
      <div style={{ marginBottom: 24 }}>
        <SkeletonBar w={180} h={26} />
        <div style={{ marginTop: 10 }}>
          <SkeletonBar w={420} h={14} />
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
        <SkeletonTiles count={4} />
      </div>

      <SkeletonRows rows={6} cols={4} />
    </div>
  );
}
