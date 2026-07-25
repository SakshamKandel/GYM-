import type { Metadata } from 'next';
import { PageHeader } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { ReviewQueue } from './_components/ReviewQueue';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Review' };
export const dynamic = 'force-dynamic';

/**
 * Progression review queue. The coach layout already gates this route, but we
 * re-resolve the principal to fail safe on a direct URL hit, matching the
 * other coach pages.
 *
 * Thin server shell: the queue comes from GET /api/coach/suggestions inside
 * the client <ReviewQueue> (the httpOnly gt_staff cookie rides along on the
 * same-origin fetch), so approve/adjust actions update the list in place.
 */
export default async function CoachReviewPage() {
  await requireCoachPage('coach.user.read');

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="Review"
        subtitle="Next-weight suggestions from your clients' recent training, oldest first. Approve one as it stands, or change the weight and say why. Whatever you sign off carries your badge in their app."
      />
      <ReviewQueue />
    </div>
  );
}
