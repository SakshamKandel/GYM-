import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { GymModerationConsole } from './_components/GymModerationConsole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Gym listing-report + review-moderation console (plan §5 WP-11). Gated on
 * `gyms.manage` — same permission as the gym CRUD editor at `/admin/gyms`, so
 * whoever can edit a listing can also act on reports/reviews about it.
 */
export default async function AdminGymReportsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('gyms.manage')) redirect('/admin');

  return (
    <div style={{ maxWidth: 1200 }}>
      <PageHeader
        title="Gym reports & reviews"
        subtitle="Member-flagged listing corrections, and the genuine reviews that replace admin-authored ratings."
      />
      <GymModerationConsole />
    </div>
  );
}
