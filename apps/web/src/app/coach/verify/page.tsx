import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { staffFromCookie } from '@/lib/staffSession';
import { VerifyQueue } from './_components/VerifyQueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coach badge verification queue. The coach layout already gates this route,
 * but we re-resolve the principal to fail safe on a direct URL hit, matching
 * the other coach pages.
 *
 * Thin server shell: the queue comes from GET /api/coach/verifications inside
 * the client <VerifyQueue> (the httpOnly gt_staff cookie rides along on the
 * same-origin fetch), so a verify click updates the list in place.
 */
export default async function CoachVerifyPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/coach/login');

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="Verify"
        subtitle="Strength-club badges your clients have logged, oldest first. Verifying confirms the lift for the record — the member sees a verified check the moment you do."
      />
      <VerifyQueue />
    </div>
  );
}
