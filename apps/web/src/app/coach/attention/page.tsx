import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { staffFromCookie } from '@/lib/staffSession';
import { AttentionList } from './_components/AttentionList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coach attention queue. The coach layout already gates this route, but we
 * re-resolve the principal to fail safe on a direct URL hit, matching the
 * other coach pages.
 *
 * This page is a thin server shell: the roster itself comes from
 * GET /api/coach/attention inside the client <AttentionList> (the httpOnly
 * gt_staff cookie rides along on the same-origin fetch), so replying to a
 * check-in updates the list in place without a full server re-render.
 */
export default async function CoachAttentionPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/coach/login');

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="Attention"
        subtitle="Your clients sorted by who has gone quiet the longest. Silence first: no synced workouts and no check-ins beats an old one. Read the latest check-in and reply without leaving the list."
      />
      <AttentionList />
    </div>
  );
}
