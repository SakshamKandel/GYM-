import { mealBillingCycles, mealOrders, mealPaymentRequests } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Member-submitted manual meal payment (§3 / §8 / P4) — the eSewa/Khalti receipt
 * queue for a single one-time order OR a weekly billing cycle. COD never routes
 * here (it reconciles on delivery), so a COD order is rejected up front.
 *
 *  POST {orderId?|cycleId?, method, receiptUrl, note?} → EXACTLY ONE of
 *  orderId/cycleId. The amount is SERVER-authoritative: it is copied from the
 *  frozen order.totalMinor / cycle.amountMinor — the client cannot supply or
 *  influence it (invariant §8d). One live (`pending`) request per target and a
 *  globally-unique `receiptUrl` (DB unique index + friendly pre-read) prevent a
 *  member double-submitting or reusing one screenshot to fund two requests.
 *
 *  `receiptUrl` is the Cloudinary `uid` from POST /api/uploads/image
 *  {kind:'meal_receipt'} (always access:'authenticated' — never public);
 *  validated against that kind's exact uid shape so a uid minted for a different
 *  kind can't be smuggled into this column. `note` is masked via maskPii before
 *  storage (anti-poaching, §6 PII rule).
 *
 *  On a valid ORDER submission the order flips paymentStatus unpaid→
 *  receipt_submitted (best-effort CAS) so the member UI reflects "under review";
 *  admin approval later stamps it `paid`. A cycle stays `awaiting_payment` until
 *  approval flips it `paid`.
 */

const RECEIPT_UID_PATTERN = /^meal_receipt\/[0-9a-f-]{36}$/;

const bodySchema = z
  .object({
    orderId: z.string().min(1).optional(),
    cycleId: z.string().min(1).optional(),
    method: z.enum(['esewa', 'khalti']),
    receiptUrl: z.string().trim().regex(RECEIPT_UID_PATTERN),
    note: z.string().trim().max(500).optional(),
  })
  // Exactly one target (§3): an order OR a billing cycle, never both/neither.
  .refine((b) => (b.orderId ? 1 : 0) + (b.cycleId ? 1 : 0) === 1, {
    message: 'exactly_one_target',
  });

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return (error as { code?: unknown }).code === '23505';
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'meals/payments',
    limit: 20,
    windowMs: 24 * 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { orderId, cycleId, method, receiptUrl, note } = parsed.data;

  const db = getDb();

  // Resolve the server-authoritative amount + currency from the caller's own
  // target, gating on a payable state. The member never supplies the amount.
  let amountMinor: number;
  let currency: string;
  if (orderId) {
    const [order] = await db
      .select({
        id: mealOrders.id,
        totalMinor: mealOrders.totalMinor,
        currency: mealOrders.currency,
        paymentMethod: mealOrders.paymentMethod,
        paymentStatus: mealOrders.paymentStatus,
        status: mealOrders.status,
      })
      .from(mealOrders)
      .where(and(eq(mealOrders.id, orderId), eq(mealOrders.accountId, me.id)))
      .limit(1);
    if (!order) return json({ error: 'order_not_found' }, 404);
    // COD reconciles on delivery — it must never mint a payment request.
    if (order.paymentMethod === 'cod') return json({ error: 'cod_no_receipt' }, 400);
    if (order.status === 'cancelled' || order.status === 'refused') {
      return json({ error: 'order_closed' }, 409);
    }
    if (order.paymentStatus === 'paid') return json({ error: 'already_paid' }, 409);
    if (order.paymentStatus === 'refunded') return json({ error: 'order_refunded' }, 409);
    amountMinor = order.totalMinor;
    currency = order.currency;
  } else {
    const [cycle] = await db
      .select({
        id: mealBillingCycles.id,
        amountMinor: mealBillingCycles.amountMinor,
        currency: mealBillingCycles.currency,
        status: mealBillingCycles.status,
      })
      .from(mealBillingCycles)
      .where(and(eq(mealBillingCycles.id, cycleId!), eq(mealBillingCycles.accountId, me.id)))
      .limit(1);
    if (!cycle) return json({ error: 'cycle_not_found' }, 404);
    // Only a billed cycle has a frozen amount to pay. `open` isn't billed yet;
    // `paid`/`void` are terminal for payment.
    if (cycle.status !== 'awaiting_payment') return json({ error: 'cycle_not_payable' }, 409);
    amountMinor = cycle.amountMinor;
    currency = cycle.currency;
  }

  // One live request per target: a resubmitted (different) receipt while an
  // earlier one is still pending would let two approvals double-stamp the same
  // order/cycle. The DB has no partial-unique for this (a target may accrue
  // rejected history), so this read is the guard.
  const targetPredicate = orderId
    ? eq(mealPaymentRequests.orderId, orderId)
    : eq(mealPaymentRequests.cycleId, cycleId!);
  const [pending] = await db
    .select({ id: mealPaymentRequests.id })
    .from(mealPaymentRequests)
    .where(and(targetPredicate, eq(mealPaymentRequests.status, 'pending')))
    .limit(1);
  if (pending) return json({ error: 'already_pending' }, 409);

  // Receipt reuse guard (friendly fast path; the unique index below is the
  // concurrency-safe one): one screenshot funds at most one request, ever.
  const [dupe] = await db
    .select({ id: mealPaymentRequests.id })
    .from(mealPaymentRequests)
    .where(eq(mealPaymentRequests.receiptUrl, receiptUrl))
    .limit(1);
  if (dupe) return json({ error: 'receipt_already_used' }, 409);

  let inserted: { id: string; status: string };
  try {
    const [row] = await db
      .insert(mealPaymentRequests)
      .values({
        accountId: me.id,
        orderId: orderId ?? null,
        cycleId: cycleId ?? null,
        amountMinor,
        currency,
        method,
        receiptUrl,
        note: note ? maskPii(note) : null,
      })
      .returning({ id: mealPaymentRequests.id, status: mealPaymentRequests.status });
    inserted = row;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // The only unique constraint on the row is receiptUrl — a concurrent
    // submission won the insert first.
    return json({ error: 'receipt_already_used' }, 409);
  }

  // Reflect "under review" on the order (best-effort; never undoes the request).
  // CAS from unpaid so a paid/refunded order is never dragged backwards.
  if (orderId) {
    try {
      await db
        .update(mealOrders)
        .set({ paymentStatus: 'receipt_submitted', updatedAt: new Date() })
        .where(and(eq(mealOrders.id, orderId), eq(mealOrders.paymentStatus, 'unpaid')));
    } catch (err) {
      console.error('[meals] order paymentStatus flip failed', err);
    }
  }

  return json({ request: { id: inserted.id, status: inserted.status } }, 201);
}
