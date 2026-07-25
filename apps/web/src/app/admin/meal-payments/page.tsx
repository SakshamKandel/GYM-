import { accounts, mealBillingCycles, mealOrders, mealPaymentRequests } from '@gym/db';
import { desc, eq, ne, type SQL, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';
import { DownloadCsv } from '../_components/DownloadCsv';
import {
  type MealPaymentRequestRow,
  type MealPaymentStatusCounts,
  MealPaymentsQueue,
} from './_components/MealPaymentsQueue';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Meal payments' };
export const dynamic = 'force-dynamic';

// The nav link 404'd until this page existed (P0-10). Mirrors the
// subscription Payments page + the complete mobile meal-payments screen
// (apps/mobile/src/app/staff/admin/meal-payments.tsx) against the EXISTING,
// unchanged GET/POST /api/admin/meal-payments/** routes — this file only
// adds the missing web view.
//
// Pending is loaded UNBOUNDED (up to a very high safety ceiling); decided
// history is capped. A single flat newest-N load — what this page used to do —
// silently drops the OLDEST pending receipts once N rows exist, and because the
// tabs filter that slice in memory those receipts become invisible AND
// unactionable: money the member already paid, stuck forever. Same split the
// sibling membership-payments page (admin/payments/page.tsx) already uses.
// PENDING_CAP is a safety ceiling, not an expected working-set size.
const PENDING_CAP = 2000;
const DECIDED_CAP = 200;

async function selectRequests(where: SQL, cap: number) {
  return getDb()
    .select({
      id: mealPaymentRequests.id,
      accountId: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      amountMinor: mealPaymentRequests.amountMinor,
      currency: mealPaymentRequests.currency,
      method: mealPaymentRequests.method,
      receiptUid: mealPaymentRequests.receiptUrl,
      note: mealPaymentRequests.note,
      status: mealPaymentRequests.status,
      reviewNote: mealPaymentRequests.reviewNote,
      createdAt: mealPaymentRequests.createdAt,
      decidedAt: mealPaymentRequests.decidedAt,
      orderId: mealPaymentRequests.orderId,
      cycleId: mealPaymentRequests.cycleId,
      orderTotalMinor: mealOrders.totalMinor,
      orderStatus: mealOrders.status,
      orderPaymentStatus: mealOrders.paymentStatus,
      orderDeliveryDate: mealOrders.deliveryDate,
      orderWindow: mealOrders.window,
      cycleWeekStart: mealBillingCycles.weekStart,
      cycleWeekEnd: mealBillingCycles.weekEnd,
      cycleAmountMinor: mealBillingCycles.amountMinor,
      cycleStatus: mealBillingCycles.status,
    })
    .from(mealPaymentRequests)
    .innerJoin(accounts, eq(accounts.id, mealPaymentRequests.accountId))
    .leftJoin(mealOrders, eq(mealOrders.id, mealPaymentRequests.orderId))
    .leftJoin(mealBillingCycles, eq(mealBillingCycles.id, mealPaymentRequests.cycleId))
    .where(where)
    .orderBy(desc(mealPaymentRequests.createdAt))
    .limit(cap);
}

async function loadMealPaymentRequests(): Promise<{
  requests: MealPaymentRequestRow[];
  counts: MealPaymentStatusCounts;
}> {
  const db = getDb();

  const [pendingRaw, decidedRaw, countRows] = await Promise.all([
    selectRequests(eq(mealPaymentRequests.status, 'pending'), PENDING_CAP),
    selectRequests(ne(mealPaymentRequests.status, 'pending'), DECIDED_CAP),
    db
      .select({ status: mealPaymentRequests.status, n: sql<string>`count(*)::text` })
      .from(mealPaymentRequests)
      .groupBy(mealPaymentRequests.status),
  ]);
  const rows = [...pendingRaw, ...decidedRaw];

  const counts: MealPaymentStatusCounts = { pending: 0, approved: 0, rejected: 0, refunded: 0 };
  for (const c of countRows) {
    if (c.status in counts) counts[c.status as keyof MealPaymentStatusCounts] = Number(c.n);
  }

  const provider = getVideoProvider();
  const requests: MealPaymentRequestRow[] = await Promise.all(
    rows.map(async (r) => {
      let receiptUrl: string;
      try {
        receiptUrl = await provider.signedImageUrl(r.receiptUid);
      } catch (err) {
        if (!(err instanceof NotConfiguredError)) throw err;
        receiptUrl = `unsigned:${r.receiptUid}`;
      }
      return {
        id: r.id,
        account: { id: r.accountId, email: r.email, displayName: r.displayName },
        target: r.orderId
          ? {
              kind: 'order' as const,
              id: r.orderId,
              totalMinor: r.orderTotalMinor,
              status: r.orderStatus,
              paymentStatus: r.orderPaymentStatus,
              deliveryDate: r.orderDeliveryDate,
              window: r.orderWindow,
            }
          : {
              kind: 'cycle' as const,
              id: r.cycleId,
              amountMinor: r.cycleAmountMinor,
              status: r.cycleStatus,
              weekStart: r.cycleWeekStart,
              weekEnd: r.cycleWeekEnd,
            },
        amountMinor: r.amountMinor,
        currency: r.currency,
        method: r.method as MealPaymentRequestRow['method'],
        receiptUrl,
        note: r.note,
        status: r.status as MealPaymentRequestRow['status'],
        reviewNote: r.reviewNote,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      };
    }),
  );

  return { requests, counts };
}

/**
 * `?orderId=` is the disputes queue's handoff: a dispute that deserves money
 * back is refunded HERE and nowhere else, so the dispute row links straight to
 * that order's receipt instead of leaving the operator to hunt for it.
 */
export default async function AdminMealPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('payments.review')) redirect('/admin');

  const params = await searchParams;
  const rawOrderId = params.orderId;
  const focusOrderId = typeof rawOrderId === 'string' && rawOrderId.trim() ? rawOrderId : null;

  const { requests, counts } = await loadMealPaymentRequests();
  const total = counts.pending + counts.approved + counts.rejected + counts.refunded;

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Meal payments"
        subtitle="Manual eSewa/Khalti payments for one-time meal orders and weekly subscription cycles. Approving marks the target paid; fulfillment is unaffected."
        action={<DownloadCsv href="/api/admin/exports/meal-payment-requests" />}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Total" value={total} />
        <StatTile label="Pending" value={counts.pending} />
        <StatTile label="Approved" value={counts.approved} />
        <StatTile label="Refunded" value={counts.refunded} />
      </div>

      <MealPaymentsQueue
        requests={requests}
        counts={counts}
        canViewMembers={permissions.has('members.read')}
        focusOrderId={focusOrderId}
      />
    </div>
  );
}
