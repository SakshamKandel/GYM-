import { SkeletonBars } from './_components/SkeletonBars';

/** Inbox loading fallback — flat skeleton rows, no shimmer/pulse. */
export default function CoachInboxLoading() {
  return (
    <div style={{ maxWidth: 760 }}>
      <div
        className="gt-skeleton"
        style={{ width: 120, height: 22, marginBottom: 24 }}
      />
      <SkeletonBars rows={6} />
    </div>
  );
}
