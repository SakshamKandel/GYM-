import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { CoachRequestQueue } from './_components/CoachRequestQueue';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Coach requests' };
export const dynamic = 'force-dynamic';

/**
 * Coach requests — the cross-coach queue of members waiting for an answer.
 *
 * Gated on `moderation.manage`, the permission that already guards both routes
 * this page calls (GET /api/admin/oversight/coach-requests and the per-request
 * cancel). content_admin holds that key and previously had no way to use it in
 * this console: the only surface was a panel inside /admin/coaches, which needs
 * `coach.assign` to open at all.
 *
 * The layout guards the /admin subtree, but this re-resolves the principal so
 * hitting the URL directly still fails safe, matching the other admin pages.
 */
export default async function AdminOversightPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');

  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('moderation.manage')) redirect('/admin');

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Coach requests"
        subtitle="Members who have asked a coach to take them on and are still waiting. Cancel one that is wrong or duplicated. Anything left unanswered for 14 days closes itself the next time this page loads, and the member is told."
      />
      <CoachRequestQueue canViewMembers={permissions.has('members.read')} />
    </div>
  );
}
