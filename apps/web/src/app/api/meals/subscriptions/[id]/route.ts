import { mealBillingCycles, mealOrders, mealSubSkips, mealSubscriptions } from '@gym/db';
import {
  canAdvanceSubscription,
  ktmDateString,
  subscriptionActionTarget,
} from '@gym/shared';
import { and, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  atomicSubscriptionEditSql,
  buildSubscriptionCycleAdjustments,
  loadDeliveryConfig,
  materializeDueOrders,
  prorateUnusedPaidDays,
  quoteSubscriptionPlan,
  subscriptionPaymentMutationBlock,
  type AtomicSubscriptionEditOutcome,
  type SubscriptionPlanShape,
} from '@/lib/meals';

export const runtime = 'nodejs';

/**
 * Subscription lifecycle (§3): pause ↔ resume, and cancel (terminal). The
 * status change is a CAS on the current status scoped to the caller's account.
 * Pausing simply removes the plan from the ACTIVE materialization filter (no
 * future spawns). Cancelling additionally CAS-cancels any already-materialized
 * future orders whose cutoff hasn't passed, so a cancelled plan never delivers.
 */

const lifecycleSchema = z.object({ action: z.enum(['pause', 'resume', 'cancel']) }).strict();
const editSchema = z
  .object({
    action: z.literal('edit'),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    window: z.enum(['lunch', 'dinner']),
    planType: z.enum(['fixed_meal', 'partner_rotating']),
    mealId: z.string().min(1).nullable(),
    addressId: z.string().min(1),
  })
  .strict();
const bodySchema = z.discriminatedUnion('action', [lifecycleSchema, editSchema]);

export function OPTIONS() {
  return preflight();
}

/**
 * Estimate the refund owed across a plan's PAID future weekly cycles when the
 * member cancels (Pack G proration). Read-only: it sums `prorateUnusedPaidDays`
 * over every paid cycle whose billed week hasn't fully elapsed, minus skips. The
 * number is an ESTIMATE support acts on — this route never moves money.
 */
async function estimatePaidProration(
  db: ReturnType<typeof getDb>,
  subscriptionId: string,
  daysOfWeek: number[],
  today: string,
): Promise<{ estimatedMinor: number; currency: string | null; unusedDays: number }> {
  const cycles = await db
    .select({
      weekStart: mealBillingCycles.weekStart,
      pricePerDayMinor: mealBillingCycles.pricePerDayMinor,
      amountMinor: mealBillingCycles.amountMinor,
      currency: mealBillingCycles.currency,
    })
    .from(mealBillingCycles)
    .where(
      and(
        eq(mealBillingCycles.subscriptionId, subscriptionId),
        eq(mealBillingCycles.status, 'paid'),
        gte(mealBillingCycles.weekEnd, today),
      ),
    );
  if (cycles.length === 0) return { estimatedMinor: 0, currency: null, unusedDays: 0 };

  const skipRows = await db
    .select({ deliveryDate: mealSubSkips.deliveryDate })
    .from(mealSubSkips)
    .where(and(eq(mealSubSkips.subscriptionId, subscriptionId), gte(mealSubSkips.deliveryDate, today)));
  const skipDates = new Set(skipRows.map((r) => r.deliveryDate));

  let estimatedMinor = 0;
  let unusedDays = 0;
  for (const c of cycles) {
    const p = prorateUnusedPaidDays({
      weekStart: c.weekStart,
      daysOfWeek,
      pricePerDayMinor: c.pricePerDayMinor,
      amountMinor: c.amountMinor,
      today,
      skipDates,
    });
    estimatedMinor += p.refundMinor;
    unusedDays += p.unusedDays;
  }
  return { estimatedMinor, currency: cycles[0]?.currency ?? null, unusedDays };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { action } = parsed.data;

  const db = getDb();
  const [sub] = await db
    .select({
      id: mealSubscriptions.id,
      partnerId: mealSubscriptions.partnerId,
      paymentMethod: mealSubscriptions.paymentMethod,
      startDate: mealSubscriptions.startDate,
      status: mealSubscriptions.status,
      daysOfWeek: mealSubscriptions.daysOfWeek,
      updatedAt: mealSubscriptions.updatedAt,
    })
    .from(mealSubscriptions)
    .where(and(eq(mealSubscriptions.id, id), eq(mealSubscriptions.accountId, me.id)))
    .limit(1);
  if (!sub) return json({ error: 'not_found' }, 404);

  if (action === 'edit') {
    if (sub.status === 'cancelled') return json({ error: 'not_active' }, 409);

    const shape: SubscriptionPlanShape = {
      daysOfWeek: [...new Set(parsed.data.daysOfWeek)].sort((a, b) => a - b),
      window: parsed.data.window,
      planType: parsed.data.planType,
      mealId: parsed.data.planType === 'fixed_meal' ? parsed.data.mealId : null,
      addressId: parsed.data.addressId,
    };
    const quoted = await quoteSubscriptionPlan({
      db,
      accountId: me.id,
      partnerId: sub.partnerId,
      paymentMethod: sub.paymentMethod,
      shape,
    });
    if (!quoted.ok) return json({ error: quoted.error }, 400);

    const now = new Date();
    const today = ktmDateString(now);
    const config = await loadDeliveryConfig(db);
    const cycleRows = await db
      .select({
        id: mealBillingCycles.id,
        weekStart: mealBillingCycles.weekStart,
        status: mealBillingCycles.status,
        plannedSlots: mealBillingCycles.plannedSlots,
        updatedAt: mealBillingCycles.updatedAt,
      })
      .from(mealBillingCycles)
      .where(
        and(
          eq(mealBillingCycles.subscriptionId, sub.id),
          gte(mealBillingCycles.weekEnd, today),
          inArray(mealBillingCycles.status, ['open', 'awaiting_payment', 'void']),
        ),
      );
    // The WHERE above excludes 'paid' at runtime; narrow the row type to match
    // (paid cycles are funded money and must never be repriced — see
    // buildSubscriptionCycleAdjustments's contract).
    const cycles = cycleRows.filter(
      (c): c is (typeof cycleRows)[number] & { status: 'open' | 'awaiting_payment' | 'void' } =>
        c.status !== 'paid',
    );
    const [skipRows, materializedRows] = await Promise.all([
      db
        .select({ deliveryDate: mealSubSkips.deliveryDate })
        .from(mealSubSkips)
        .where(and(eq(mealSubSkips.subscriptionId, sub.id), gte(mealSubSkips.deliveryDate, today))),
      db
        .select({ deliveryDate: mealOrders.deliveryDate })
        .from(mealOrders)
        .where(and(eq(mealOrders.subscriptionId, sub.id), gte(mealOrders.deliveryDate, today))),
    ]);
    // Every already-materialized date stays frozen. Treating it as a plan-level
    // suppression date prevents a window edit from spawning a second order for
    // the same day while preserving the original order snapshot.
    const suppressedDates = new Set([
      ...skipRows.map((row) => row.deliveryDate),
      ...materializedRows.map((row) => row.deliveryDate),
    ]);
    const cycleAdjustments = buildSubscriptionCycleAdjustments({
      cycles,
      startDate: sub.startDate,
      shape,
      pricePerDayMinor: quoted.quote.pricePerDayMinor,
      skipDates: suppressedDates,
      now,
      config,
    });

    const result = await db.execute(
      atomicSubscriptionEditSql({
        subscriptionId: sub.id,
        accountId: me.id,
        partnerId: sub.partnerId,
        expectedUpdatedAt: sub.updatedAt,
        now,
        today,
        shape,
        pricePerDayMinor: quoted.quote.pricePerDayMinor,
        currency: quoted.quote.currency,
        cycleAdjustments,
      }),
    );
    const resultRow = result.rows[0];
    const outcome: AtomicSubscriptionEditOutcome =
      resultRow && typeof resultRow.outcome === 'string'
        ? (resultRow.outcome as AtomicSubscriptionEditOutcome)
        : 'conflict';
    if (outcome !== 'updated') {
      const status = outcome === 'not_found' ? 404 : 409;
      return json({ error: outcome }, status);
    }

    await materializeDueOrders(db, { kind: 'member', accountId: me.id }, now);
    const preservedOrderDates =
      resultRow && Array.isArray(resultRow.preserved_order_dates)
        ? resultRow.preserved_order_dates.filter((date): date is string => typeof date === 'string')
        : [];
    return json(
      {
        subscription: {
          id: sub.id,
          status: sub.status,
          daysOfWeek: shape.daysOfWeek,
          window: shape.window,
          planType: shape.planType,
          mealId: shape.mealId,
          addressId: shape.addressId,
          pricePerDayMinor: quoted.quote.pricePerDayMinor,
          currency: quoted.quote.currency,
        },
        effective: {
          mode: 'future_unmaterialized',
          fromDate: today,
          preservedOrderDates,
        },
      },
      200,
    );
  }

  const target = subscriptionActionTarget(action);
  if (!canAdvanceSubscription(sub.status, target)) {
    return json({ error: 'invalid_transition' }, 409);
  }

  // Pausing or cancelling can suppress prepaid slots that have not yet entered
  // the two-day materialization horizon. Support must reject a pending receipt
  // or use the dedicated refund route before this lifecycle mutation.
  if (target === 'paused' || target === 'cancelled') {
    const paymentBlock = await subscriptionPaymentMutationBlock({
      db,
      subscriptionId: sub.id,
      scope: { kind: 'remaining' },
    });
    if (paymentBlock) {
      // Cancelling a plan with a funded future week can't self-serve refund
      // (money un-moves only on the admin rail), but the member deserves to see
      // what they're owed and be routed to support (Pack G). Surface a proration
      // ESTIMATE alongside the block — informational only, never moves money.
      if (target === 'cancelled' && paymentBlock === 'refund_required') {
        const refund = await estimatePaidProration(
          db,
          sub.id,
          sub.daysOfWeek,
          ktmDateString(new Date()),
        );
        return json({ error: paymentBlock, refund }, 409);
      }
      return json({ error: paymentBlock }, 409);
    }
  }

  const updated = await db
    .update(mealSubscriptions)
    .set({ status: target, updatedAt: new Date() })
    .where(
      and(
        eq(mealSubscriptions.id, sub.id),
        eq(mealSubscriptions.accountId, me.id),
        eq(mealSubscriptions.status, sub.status),
      ),
    )
    .returning();
  const row = updated[0];
  if (!row) return json({ error: 'conflict' }, 409);

  // Close the read/CAS race with receipt submission or approval. If money
  // became protected after the preflight, compensate the lifecycle CAS before
  // any fulfilment rows are touched and direct the caller to support.
  if (target === 'paused' || target === 'cancelled') {
    const paymentBlock = await subscriptionPaymentMutationBlock({
      db,
      subscriptionId: sub.id,
      scope: { kind: 'remaining' },
    });
    if (paymentBlock) {
      const reverted = await db
        .update(mealSubscriptions)
        .set({ status: sub.status, updatedAt: new Date() })
        .where(
          and(
            eq(mealSubscriptions.id, sub.id),
            eq(mealSubscriptions.accountId, me.id),
            eq(mealSubscriptions.status, target),
          ),
        )
        .returning({ id: mealSubscriptions.id });
      return json({ error: reverted[0] ? paymentBlock : 'conflict' }, 409);
    }
  }

  // A cancelled plan must not deliver: void its still-cancellable future orders
  // (pending, cutoff not yet passed). Bulk lifecycle action — no per-order push.
  if (target === 'cancelled') {
    const cancelNow = new Date();
    const today = ktmDateString(cancelNow);
    await db
      .update(mealOrders)
      .set({
        status: 'cancelled',
        statusVersion: sql`${mealOrders.statusVersion} + 1`,
        cancelledAt: cancelNow,
        cancelReason: 'Subscription cancelled',
        decidedBy: me.id,
        updatedAt: cancelNow,
      })
      .where(
        and(
          eq(mealOrders.subscriptionId, sub.id),
          eq(mealOrders.status, 'pending'),
          inArray(mealOrders.paymentStatus, ['unpaid', 'refunded']),
          gte(mealOrders.deliveryDate, today),
          gt(mealOrders.cutoffAt, cancelNow),
        ),
      );

    // Void any still-open/awaiting_payment billing cycle: a cancelled plan
    // produces zero deliveries, so an unpaid prepaid cycle must not stay
    // payable (the member could otherwise settle a bill for a week that will
    // never be materialized). Cycle void is otherwise admin-only.
    await db
      .update(mealBillingCycles)
      .set({ status: 'void', updatedAt: cancelNow })
      .where(
        and(
          eq(mealBillingCycles.subscriptionId, sub.id),
          inArray(mealBillingCycles.status, ['open', 'awaiting_payment']),
        ),
      );
  }

  return json(
    {
      subscription: {
        id: row.id,
        status: row.status,
      },
    },
    200,
  );
}
