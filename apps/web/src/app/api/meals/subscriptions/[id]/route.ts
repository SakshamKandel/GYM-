import { mealBillingCycles, mealOrders, mealSubscriptions } from '@gym/db';
import {
  canAdvanceSubscription,
  ktmDateString,
  subscriptionActionTarget,
} from '@gym/shared';
import { and, eq, gt, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Subscription lifecycle (§3): pause ↔ resume, and cancel (terminal). The
 * status change is a CAS on the current status scoped to the caller's account.
 * Pausing simply removes the plan from the ACTIVE materialization filter (no
 * future spawns). Cancelling additionally CAS-cancels any already-materialized
 * future orders whose cutoff hasn't passed, so a cancelled plan never delivers.
 */

const bodySchema = z.object({ action: z.enum(['pause', 'resume', 'cancel']) });

export function OPTIONS() {
  return preflight();
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
    .select({ id: mealSubscriptions.id, status: mealSubscriptions.status })
    .from(mealSubscriptions)
    .where(and(eq(mealSubscriptions.id, id), eq(mealSubscriptions.accountId, me.id)))
    .limit(1);
  if (!sub) return json({ error: 'not_found' }, 404);

  const target = subscriptionActionTarget(action);
  if (!canAdvanceSubscription(sub.status, target)) {
    return json({ error: 'invalid_transition' }, 409);
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

  // A cancelled plan must not deliver: void its still-cancellable future orders
  // (pending, cutoff not yet passed). Bulk lifecycle action — no per-order push.
  if (target === 'cancelled') {
    const today = ktmDateString(new Date());
    await db
      .update(mealOrders)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Subscription cancelled' })
      .where(
        and(
          eq(mealOrders.subscriptionId, sub.id),
          eq(mealOrders.status, 'pending'),
          gte(mealOrders.deliveryDate, today),
          gt(mealOrders.cutoffAt, new Date()),
        ),
      );

    // Void any still-open/awaiting_payment billing cycle: a cancelled plan
    // produces zero deliveries, so an unpaid prepaid cycle must not stay
    // payable (the member could otherwise settle a bill for a week that will
    // never be materialized). Cycle void is otherwise admin-only.
    await db
      .update(mealBillingCycles)
      .set({ status: 'void', updatedAt: new Date() })
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
