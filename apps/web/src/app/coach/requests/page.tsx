import type { Metadata } from 'next';
import { PageHeader } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { RequestQueue } from './_components/RequestQueue';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Requests' };
export const dynamic = 'force-dynamic';

/**
 * Coach console — inbound coaching requests. Until this page existed the queue
 * was mobile-only, so requests addressed to a desktop-only coach sat unanswered
 * until they aged out. The coach layout already gates the route; we re-resolve
 * the principal to fail safe on a direct URL hit, matching the other coach pages.
 *
 * Thin server shell: the queue is fetched inside the client <RequestQueue> from
 * GET /api/coach/requests, and decisions POST to /api/coach/requests/[id] —
 * where the capacity re-check, the "my coach is singular" rule and the member
 * notification all live.
 */
export default async function CoachRequestsPage() {
  await requireCoachPage('coach.user.read');

  return (
    <div style={{ maxWidth: 760 }}>
      <PageHeader
        title="Requests"
        subtitle="Members asking you to coach them, longest wait first. Accepting adds them to your clients and opens your chat; declining frees them to look for another coach."
      />
      <RequestQueue />
    </div>
  );
}
