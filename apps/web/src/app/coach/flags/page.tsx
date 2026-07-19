import { PageHeader } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { FlagsList } from './_components/FlagsList';

export const runtime = 'nodejs';
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
        subtitle="Workouts our plausibility check excluded from rankings and badges, unacknowledged first. This is not an accusation — it only means the numbers looked off, and the entry stays in the member's own log either way."
      />
      <FlagsList />
    </div>
  );
}
