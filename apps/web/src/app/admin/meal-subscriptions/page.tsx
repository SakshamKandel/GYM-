import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { MealSubscriptionsRoster } from './_components/MealSubscriptionsRoster';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin console — meal-subscription roster (WP-11 / P0-11 admin half). Before
 * this page, ops had no surface at all to inspect an individual member's
 * recurring meal plan or pause/cancel it — only the payment-request queue and
 * order-fulfillment override existed. Data loads client-side from the new
 * `GET /api/admin/meal-subscriptions` route (status/search filters live in
 * the URL-less client state, matching the other roster consoles' pattern of
 * client-fetched, permission-gated lists).
 */
export default async function AdminMealSubscriptionsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('payments.review')) redirect('/admin');

  return (
    <div style={{ maxWidth: 1200 }}>
      <PageHeader
        title="Meal subscriptions"
        subtitle="Every member's recurring meal plan — schedule, partner, price, and this week's billing-cycle state. Pause or cancel a plan on the member's behalf."
      />
      <MealSubscriptionsRoster />
    </div>
  );
}
