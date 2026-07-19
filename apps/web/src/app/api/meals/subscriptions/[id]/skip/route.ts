import { mealOrders, mealSubSkips, mealSubscriptions } from '@gym/db';
import { cutoffFor, ktmDateString, ktmDayOfWeek } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  advanceOrderStatus,
  loadDeliveryConfig,
  subscriptionPaymentMutationBlock,
} from '@/lib/meals';

export const runtime = 'nodejs';

/**
 * Skip one delivery date of a subscription (§3). Recording a skip suppresses
 * materialization BEFORE the order exists; if the order was already spawned for
 * that slot it is additionally CAS-cancelled (both guarded `now < cutoff`, so a
 * member can't skip a slot that's already being cooked). Idempotent via the
 * (subscriptionId, deliveryDate) unique index.
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
  if (!sub.daysOfWeek.includes(ktmDayOfWeek(deliveryDate))) {
    return json({ error: 'not_a_delivery_day' }, 400);
  }
  const cfg = await loadDeliveryConfig(db);
  if (now.getTime() >= cutoffFor(deliveryDate, sub.window, 'Asia/Kathmandu', cfg).getTime()) {
    return json({ error: 'past_cutoff' }, 400);
  }

  const paymentBlock = await subscriptionPaymentMutationBlock({
    db,
    subscriptionId: sub.id,
    scope: { kind: 'slot', deliveryDate, window: sub.window },
    now,
  });
  if (paymentBlock) return json({ error: paymentBlock }, 409);

  // Record the skip (idempotent) — suppresses any future spawn for this slot.
  await db
    .insert(mealSubSkips)
    .values({ subscriptionId: sub.id, deliveryDate })
    .onConflictDoNothing({ target: [mealSubSkips.subscriptionId, mealSubSkips.deliveryDate] });

  // If the order was already materialized for this slot, cancel it (CAS on
  // 'pending' scoped to the caller — a lost race just no-ops).
  const [existing] = await db
    .select({ id: mealOrders.id, status: mealOrders.status })
    .from(mealOrders)
    .where(
      and(
        eq(mealOrders.subscriptionId, sub.id),
        eq(mealOrders.deliveryDate, deliveryDate),
        eq(mealOrders.window, sub.window),
        eq(mealOrders.source, 'subscription'),
      ),
    )
    .limit(1);
  if (existing && existing.status === 'pending') {
    await advanceOrderStatus({
      db,
      orderId: existing.id,
      expectedStatus: 'pending',
      toStatus: 'cancelled',
      actor: 'member',
      actorId: me.id,
      scope: { accountId: me.id },
      cancelReason: 'Skipped by member',
      now,
    });
  }

  return json({ ok: true }, 200);
}
