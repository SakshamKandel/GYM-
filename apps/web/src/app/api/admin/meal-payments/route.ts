import { accounts, mealBillingCycles, mealOrders, mealPaymentRequests } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Admin console — the meal manual-payment queue (§3 / P4), a sibling of the
 * subscription payment queue (api/admin/payment-requests). Reuses the existing
 * `payments.review` permission (no new key per the plan).
 *
 *  GET `?status=pending|approved|rejected|refunded` → every meal payment request
 *  (optionally filtered), newest first, joined to the submitting account
 *  (id/email/displayName — staff-only view) and its target context (order total/
 *  status/date/window, or cycle week/amount/status). `receiptUrl` is re-minted as
 *  a fresh SIGNED Cloudinary url from the stored uid on every read (never
 *  cached); when the image provider isn't configured it falls back to
 *  `unsigned:<uid>` so the row stays visible/actionable instead of 503ing the
 *  whole list.
 *
 * Guarded by requirePermission('payments.review'); super_admin/main_admin pass.
 */

const MAX_ROWS = 200;
const STATUSES = ['pending', 'approved', 'rejected', 'refunded'] as const;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'payments.review');
  if (principal instanceof Response) return principal;

  const statusParam = new URL(req.url).searchParams.get('status');
  const status = (STATUSES as readonly string[]).includes(statusParam ?? '')
    ? (statusParam as (typeof STATUSES)[number])
    : undefined;

  const db = getDb();
  const rows = await db
    .select({
      id: mealPaymentRequests.id,
      accountId: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      orderId: mealPaymentRequests.orderId,
      cycleId: mealPaymentRequests.cycleId,
      amountMinor: mealPaymentRequests.amountMinor,
      currency: mealPaymentRequests.currency,
      method: mealPaymentRequests.method,
      receiptUid: mealPaymentRequests.receiptUrl,
      note: mealPaymentRequests.note,
      status: mealPaymentRequests.status,
      reviewNote: mealPaymentRequests.reviewNote,
      createdAt: mealPaymentRequests.createdAt,
      decidedAt: mealPaymentRequests.decidedAt,
      // Order context (null for cycle-scoped requests).
      orderTotalMinor: mealOrders.totalMinor,
      orderStatus: mealOrders.status,
      orderPaymentStatus: mealOrders.paymentStatus,
      orderDeliveryDate: mealOrders.deliveryDate,
      orderWindow: mealOrders.window,
      // Cycle context (null for order-scoped requests).
      cycleWeekStart: mealBillingCycles.weekStart,
      cycleWeekEnd: mealBillingCycles.weekEnd,
      cycleAmountMinor: mealBillingCycles.amountMinor,
      cycleStatus: mealBillingCycles.status,
    })
    .from(mealPaymentRequests)
    .innerJoin(accounts, eq(accounts.id, mealPaymentRequests.accountId))
    .leftJoin(mealOrders, eq(mealOrders.id, mealPaymentRequests.orderId))
    .leftJoin(mealBillingCycles, eq(mealBillingCycles.id, mealPaymentRequests.cycleId))
    .where(status ? eq(mealPaymentRequests.status, status) : undefined)
    .orderBy(desc(mealPaymentRequests.createdAt))
    .limit(MAX_ROWS);

  const provider = getVideoProvider();
  const requests = await Promise.all(
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
        method: r.method,
        receiptUrl,
        note: r.note,
        status: r.status,
        reviewNote: r.reviewNote,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
      };
    }),
  );

  return json({ requests }, 200);
}
