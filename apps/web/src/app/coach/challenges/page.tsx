import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { staffFromCookie } from '@/lib/staffSession';
import { ChallengeManager } from './_components/ChallengeManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coach console — the coach's monthly challenge + Coach's pick spotlight. The
 * coach layout already gates this route, but we re-resolve the principal to
 * fail safe on a direct URL hit, matching the other coach pages.
 *
 * Thin server shell: everything comes from GET /api/coach/challenges and
 * GET /api/coach/users inside the client <ChallengeManager> (the httpOnly
 * gt_staff cookie rides along on the same-origin fetch). ONE active challenge
 * per coach per month — the create form only shows when there is none yet.
 */
export default async function CoachChallengesPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/coach/login');

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="Challenges"
        subtitle="One monthly challenge for your clients — everyone who reaches the target session-day count earns the badge, no winner and no ranking. Pick one member a month to spotlight with Coach's pick."
      />
      <ChallengeManager />
    </div>
  );
}
