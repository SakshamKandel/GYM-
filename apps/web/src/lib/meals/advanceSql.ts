import type { OrderActor, OrderStatus } from '@gym/shared';
import { sql, type SQL } from 'drizzle-orm';

export interface AtomicAdvanceOrderSqlParams {
  orderId: string;
  expectedStatus: OrderStatus;
  toStatus: OrderStatus;
  actor: OrderActor;
  actorId: string | null;
  scope?: { partnerId?: string; accountId?: string };
  cancelReason?: string | null;
  now: Date;
  eventId: string;
  /**
   * Admin-only forced money reversal. Default (`undefined`/false) keeps the
   * historical destructive-transition guard EXACTLY as it was: a cancel/refuse
   * only matches `payment_status in ('unpaid','refunded')`, so captured money
   * can never be stranded by an ordinary caller.
   *
   * When true (and the target is cancelled/refused) the guard inverts to
   * `payment_status = 'paid'` and the SAME statement writes
   * `payment_status = 'refunded'` — one compare-and-set that both reverses the
   * payment and reaches the terminal status, with the append-only event still
   * written by the CTE below. Nothing is widened: the two predicate sets are
   * disjoint, so this adds the missing escape hatch for a paid order without
   * loosening any existing path.
   */
  reversePayment?: boolean;
}

const mealOrdersTable = sql.identifier('meal_orders');
const mealOrderEventsTable = sql.identifier('meal_order_events');

/**
 * One-statement order CAS + append-only event write. The final join is also a
 * structural guarantee that a returned order always has its event row.
 */
export function atomicAdvanceOrderSql(params: AtomicAdvanceOrderSqlParams): SQL {
  const {
    orderId,
    expectedStatus,
    toStatus,
    actor,
    actorId,
    scope,
    cancelReason,
    now,
    eventId,
  } = params;

  const destructive = toStatus === 'cancelled' || toStatus === 'refused';
  // The reversal flag only ever applies to a destructive target, so the guard
  // predicate and the payment write can never disagree.
  const forcedReversal = destructive && params.reversePayment === true;

  const assignments: SQL[] = [
    sql`status = ${toStatus}`,
    sql`status_version = status_version + 1`,
    sql`updated_at = ${now}`,
    sql`decided_by = ${actorId}`,
  ];
  if (toStatus === 'confirmed') assignments.push(sql`confirmed_at = ${now}`);
  if (toStatus === 'delivered') {
    assignments.push(sql`delivered_at = ${now}`);
    // Cash-on-delivery reconciliation. For a COD order the money changes hands
    // AT the door, so the delivered transition IS the payment event — it is
    // written in the SAME statement as the CAS, because a separate follow-up
    // UPDATE could be lost to a crash and leave the row delivered-but-unpaid
    // forever (the state it had before this line existed: partner earnings
    // counted the cash, the order still read "unpaid", and the member could
    // keep editing the tip afterwards — /api/meals/orders/[id]/tip only
    // requires `payment_status = 'unpaid'`).
    //
    // Deliberately narrow, so nothing else can be reached by this assignment:
    //  - `payment_method = 'cod'`  — a digital order's paid flip stays owned by
    //    the receipt-approval path (admin/meal-payments), never by fulfilment;
    //  - `payment_status = 'unpaid'` — a refunded COD order is never
    //    resurrected to paid, and `receipt_submitted` stays with support.
    // Everything else keeps its current value, so this is a no-op for them.
    assignments.push(
      sql`payment_status = case
        when payment_method = 'cod' and payment_status = 'unpaid' then 'paid'
        else payment_status
      end`,
    );
  }
  if (toStatus === 'cancelled') {
    assignments.push(sql`cancelled_at = ${now}`, sql`cancel_reason = ${cancelReason ?? null}`);
  }
  if (forcedReversal) assignments.push(sql`payment_status = 'refunded'`);

  const predicates: SQL[] = [sql`id = ${orderId}`, sql`status = ${expectedStatus}`];
  if (scope?.partnerId) predicates.push(sql`partner_id = ${scope.partnerId}`);
  if (scope?.accountId) predicates.push(sql`account_id = ${scope.accountId}`);
  // Concurrency backstop: destructive transitions may not strand captured
  // money or an in-review receipt. The dedicated refund path is separate.
  // A forced reversal is the mirror image — it may ONLY act on captured money
  // ('paid'), and reverses it in the same statement.
  if (destructive) {
    predicates.push(
      forcedReversal
        ? sql`payment_status = 'paid'`
        : sql`payment_status in ('unpaid', 'refunded')`,
    );
  }

  return sql`
    with updated_order as (
      update ${mealOrdersTable}
      set ${sql.join(assignments, sql`, `)}
      where ${sql.join(predicates, sql` and `)}
      returning *
    ),
    inserted_event as (
      insert into ${mealOrderEventsTable} (
        id, order_id, from_status, to_status, actor_id, actor_role
      )
      select
        ${eventId}, updated_order.id, ${expectedStatus}, ${toStatus}, ${actorId}, ${actor}
      from updated_order
      returning order_id
    )
    select
      updated_order.id,
      updated_order.account_id as "accountId",
      updated_order.partner_id as "partnerId",
      updated_order.source,
      updated_order.subscription_id as "subscriptionId",
      updated_order.cycle_id as "cycleId",
      updated_order.client_request_id as "clientRequestId",
      updated_order.request_fingerprint as "requestFingerprint",
      updated_order.delivery_date as "deliveryDate",
      updated_order.window,
      updated_order.address_id as "addressId",
      updated_order.delivery_name as "deliveryName",
      updated_order.delivery_phone as "deliveryPhone",
      updated_order.delivery_address_text as "deliveryAddressText",
      updated_order.delivery_lat as "deliveryLat",
      updated_order.delivery_lng as "deliveryLng",
      updated_order.delivery_notes as "deliveryNotes",
      updated_order.subtotal_minor as "subtotalMinor",
      updated_order.delivery_fee_minor as "deliveryFeeMinor",
      updated_order.small_order_fee_minor as "smallOrderFeeMinor",
      updated_order.total_minor as "totalMinor",
      updated_order.currency,
      updated_order.payment_method as "paymentMethod",
      updated_order.payment_status as "paymentStatus",
      updated_order.status,
      updated_order.status_version as "statusVersion",
      updated_order.cutoff_at as "cutoffAt",
      updated_order.placed_at as "placedAt",
      updated_order.confirmed_at as "confirmedAt",
      updated_order.delivered_at as "deliveredAt",
      updated_order.cancelled_at as "cancelledAt",
      updated_order.cancel_reason as "cancelReason",
      updated_order.decided_by as "decidedBy",
      updated_order.updated_at as "updatedAt"
    from updated_order
    inner join inserted_event on inserted_event.order_id = updated_order.id
  `;
}
