import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { staffFromCookie } from '@/lib/staffSession';
import { ReviewQueue } from './_components/ReviewQueue';

export const runtime = 'nodejs';
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
  const principal = await staffFromCookie();
  if (!principal) redirect('/coach/login');

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="Review"
        subtitle="Progression suggestions your clients' training generated, oldest first. Approve to sign off, or adjust the weight with a note. Reviewed targets show a coach badge in the member's app."
      />
      <ReviewQueue />
    </div>
  );
}
