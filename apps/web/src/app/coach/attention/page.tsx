import type { Metadata } from 'next';
import { PageHeader } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { AttentionList } from './_components/AttentionList';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Attention' };
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
  await requireCoachPage('coach.user.read');

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="Attention"
        subtitle="Your clients, quietest first. Someone who has logged nothing at all comes before someone whose last workout is a while back. Read their latest check-in and reply right here."
      />
      <AttentionList />
    </div>
  );
}
