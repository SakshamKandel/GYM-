import type { Metadata } from 'next';
import { PageHeader } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { FlagsList } from './_components/FlagsList';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Flags' };
export const dynamic = 'force-dynamic';

/**
 * Coach console — plausibility-flagged workouts of assigned clients. The
 * coach layout already gates this route, but we re-resolve the principal to
 * fail safe on a direct URL hit, matching the other coach pages.
 *
 * Thin server shell: the list comes from GET /api/coach/flags inside the
 * client <FlagsList> (the httpOnly gt_staff cookie rides along on the
 * same-origin fetch), so acknowledging a flag updates the row in place.
 *
 * Flagged workouts stay fully visible in the member's own log — this queue is
 * purely informational for the coach, never an accusation. Copy stays
 * factual: what tripped, and the numbers behind it.
 */
export default async function CoachFlagsPage() {
  await requireCoachPage('coach.user.read');

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="Flags"
        subtitle="Workouts we left out of rankings and badges because the numbers looked off, the ones you have not read yet first. This is not an accusation, and the workout stays in your client's own log either way."
      />
      <FlagsList />
    </div>
  );
}
