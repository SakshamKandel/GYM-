import { SkeletonBars } from '../../_components/SkeletonBars';

/** Thread loading fallback — flat skeleton rows, no shimmer/pulse. */
export default function CoachThreadLoading() {
  return (
    <div style={{ maxWidth: 760 }}>
      <div
        className="gt-skeleton"
        style={{ width: 200, height: 40, marginBottom: 20 }}
      />
      <SkeletonBars rows={5} />
    </div>
  );
}
