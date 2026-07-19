import {
  mealBillingCycles,
  mealOrders,
  mealPaymentRequests,
  type Db,
} from '@gym/db';
import {
  cyclePaymentMutationBlock,
  ktmDateString,
  mergePaymentMutationBlocks,
  orderPaymentMutationBlock,
  weekBoundsFor,
  type MealWindow,
  type PaymentMutationBlock,
} from '@gym/shared';
import { and, eq, gt, gte, inArray } from 'drizzle-orm';

type SubscriptionMutationScope =
  | { kind: 'slot'; deliveryDate: string; window: MealWindow }
  | { kind: 'remaining' };

/**
 * Find whether a subscription mutation would strand an approved payment or a
 * receipt that support is still reviewing. The route must run this before its
 * lifecycle CAS; affected order updates additionally carry a payment-status
 * predicate as the concurrency backstop.
 */
export async function subscriptionPaymentMutationBlock(params: {
  db: Db;
  subscriptionId: string;
  scope: SubscriptionMutationScope;
  now?: Date;
}): Promise<PaymentMutationBlock | null> {
  const { db, subscriptionId, scope } = params;
  const now = params.now ?? new Date();
  const today = ktmDateString(now);

  const orderScope =
    scope.kind === 'slot'
      ? and(
          eq(mealOrders.subscriptionId, subscriptionId),
          eq(mealOrders.deliveryDate, scope.deliveryDate),
          eq(mealOrders.window, scope.window),
          eq(mealOrders.source, 'subscription'),
        )
      : and(
          eq(mealOrders.subscriptionId, subscriptionId),
          eq(mealOrders.status, 'pending'),
          gte(mealOrders.deliveryDate, today),
          gt(mealOrders.cutoffAt, now),
        );

  const affectedOrders = await db
    .select({ paymentStatus: mealOrders.paymentStatus })
    .from(mealOrders)
    .where(orderScope);

  const cycleScope =
    scope.kind === 'slot'
      ? and(
          eq(mealBillingCycles.subscriptionId, subscriptionId),
          eq(mealBillingCycles.weekStart, weekBoundsFor(scope.deliveryDate).weekStart),
        )
      : and(
          eq(mealBillingCycles.subscriptionId, subscriptionId),
          gte(mealBillingCycles.weekEnd, today),
        );

  const affectedCycles = await db
    .select({ id: mealBillingCycles.id, status: mealBillingCycles.status })
    .from(mealBillingCycles)
    .where(cycleScope);

  const cycleIds = affectedCycles.map((cycle) => cycle.id);
  const requests =
    cycleIds.length === 0
      ? []
      : await db
          .select({
            cycleId: mealPaymentRequests.cycleId,
            status: mealPaymentRequests.status,
          })
          .from(mealPaymentRequests)
          .where(
            and(
              inArray(mealPaymentRequests.cycleId, cycleIds),
              inArray(mealPaymentRequests.status, ['pending', 'approved']),
            ),
          );

  return mergePaymentMutationBlocks([
    ...affectedOrders.map((order) => orderPaymentMutationBlock(order.paymentStatus)),
    ...affectedCycles.map((cycle) =>
      cyclePaymentMutationBlock(
        cycle.status,
        requests
          .filter((request) => request.cycleId === cycle.id)
          .map((request) => request.status),
      ),
    ),
  ]);
}
