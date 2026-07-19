import { mealSubscriptions } from '@gym/db';
import { cutoffFor, ktmDateString, ktmDayOfWeek, weekBoundsFor } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  atomicSubscriptionSkipSql,
  loadDeliveryConfig,
  mealCycleOperationLockSql,
} from '@/lib/meals';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Skip one delivery date of a subscription (§3). Recording a skip suppresses
 * materialization BEFORE the order exists; if the order was already spawned for
 * that slot it is cancelled in the same transaction. A newly inserted skip also
 * decrements and reprices an unfunded weekly cycle. The shared cycle lock makes
 * this mutually exclusive with receipt submission; duplicate skips are no-ops.
 */

const bodySchema = z.object({ deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { deliveryDate } = parsed.data;

  const db = getDb();
  const [sub] = await db
    .select({
      id: mealSubscriptions.id,
      status: mealSubscriptions.status,
      startDate: mealSubscriptions.startDate,
      window: mealSubscriptions.window,
      daysOfWeek: mealSubscriptions.daysOfWeek,
    })
    .from(mealSubscriptions)
    .where(and(eq(mealSubscriptions.id, id), eq(mealSubscriptions.accountId, me.id)))
    .limit(1);
  if (!sub) return json({ error: 'not_found' }, 404);
  if (sub.status === 'cancelled') return json({ error: 'not_active' }, 409);

  const now = new Date();
  // The date must be a subscribed weekday, today or later, and still pre-cutoff.
  if (deliveryDate < ktmDateString(now)) return json({ error: 'past_date' }, 400);
  if (deliveryDate < sub.startDate) return json({ error: 'not_a_delivery_day' }, 400);
  if (!sub.daysOfWeek.includes(ktmDayOfWeek(deliveryDate))) {
    return json({ error: 'not_a_delivery_day' }, 400);
  }
  const cfg = await loadDeliveryConfig(db);
  if (now.getTime() >= cutoffFor(deliveryDate, sub.window, 'Asia/Kathmandu', cfg).getTime()) {
    return json({ error: 'past_cutoff' }, 400);
  }

  // Record the skip (idempotent) — suppresses any future spawn for this slot.
  const weekStart = weekBoundsFor(deliveryDate).weekStart;
  const [, mutation] = await db.batch([
    db.execute(mealCycleOperationLockSql(sub.id, weekStart)),
    db.execute(
      atomicSubscriptionSkipSql({
        skipId: crypto.randomUUID(),
        eventId: crypto.randomUUID(),
        subscriptionId: sub.id,
        accountId: me.id,
        deliveryDate,
        weekStart,
        window: sub.window,
        now,
      }),
    ),
  ]);

  const mutationRow = mutation.rows[0];
  const outcome =
    mutationRow && typeof mutationRow.outcome === 'string'
      ? mutationRow.outcome
      : 'conflict';
  if (outcome === 'payment_review_required' || outcome === 'refund_required') {
    return json({ error: outcome }, 409);
  }
  if (outcome !== 'inserted' && outcome !== 'duplicate') {
    return json({ error: 'conflict' }, 409);
  }

  const cancelledOrderId =
    mutationRow && typeof mutationRow.cancelled_order_id === 'string'
      ? mutationRow.cancelled_order_id
      : null;
  if (cancelledOrderId) {
    after(() =>
      sendPushToAccount(me.id, {
        title: 'Order cancelled',
        body: 'Your subscription meal was skipped and cancelled.',
        data: { type: 'meal_order', orderId: cancelledOrderId, status: 'cancelled' },
      }),
    );
  }

  return json({ ok: true }, 200);
}
