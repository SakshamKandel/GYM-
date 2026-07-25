import { ktmDateString } from '@gym/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { ReconciliationBoard } from './_components/ReconciliationBoard';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Daily partner totals' };
export const dynamic = 'force-dynamic';

/**
 * Admin — daily all-partner meal reconciliation. The API behind this page
 * (GET /api/admin/reconciliation) was already complete but had no caller at
 * all, so the numbers finance needs to settle with restaurants were only
 * reachable by hitting the endpoint by hand.
 *
 * Guarded by 'partners.manage' — the same permission the route enforces
 * (super_admin/main_admin bypass, delegable via a per-account override). The
 * board itself fetches through that guarded route, so the data is checked twice.
 */

export default async function AdminReconciliationPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('partners.manage')) redirect('/admin');

  // Default to today's Kathmandu delivery date — the same default the API uses
  // when no `date` is supplied, so first paint matches an unparameterized call.
  const today = ktmDateString(new Date());

  return (
    <div style={{ maxWidth: 1280 }}>
      <PageHeader
        title="Daily partner totals"
        subtitle="What each kitchen took in on one delivery day. Cash they collected at the door is already theirs. Digital payments we are holding are what we still owe them. Pick a day, then download it for the books."
      />

      <ReconciliationBoard initialDate={today} />
    </div>
  );
}
