import { sql, type SQL } from 'drizzle-orm';

/**
 * One-time reconciliation of cash-on-delivery orders that were delivered BEFORE
 * the delivered-transition started closing the payment itself.
 *
 * `atomicAdvanceOrderSql` now flips a COD order to `paid` in the SAME statement
 * that marks it delivered, because for cash the money changes hands at the door.
 * That change is forward-only: every COD order delivered before it shipped still
 * reads `unpaid`, which leaves two real problems open on money that was already
 * collected —
 *
 *   1. the tip window never closes. POST /api/meals/orders/[id]/tip only
 *      requires `payment_status = 'unpaid'`, so a member can still change the
 *      total of an order the rider was already paid for in cash;
 *   2. the order contradicts the books. Partner earnings counted that cash on
 *      delivery, while the order itself still reads as awaiting payment.
 *
 * The scope here is deliberately the same three columns the forward path
 * matches on, and nothing else:
 *   - `status = 'delivered'`      — the cash actually changed hands;
 *   - `payment_method = 'cod'`    — a digital order's paid flip stays owned by
 *                                   the receipt-approval path, never by this;
 *   - `payment_status = 'unpaid'` — a refunded order is never resurrected, and
 *                                   `receipt_submitted` stays with support.
 *
 * Because the predicate matches only rows that are still `unpaid`, a second run
 * matches nothing: the backfill is idempotent by construction, not by a marker
 * column. Preview and apply share one predicate builder so the rows counted are
 * exactly the rows written.
 */

export interface CodBackfillScope {
  /**
   * Optional exclusive upper bound on `delivery_date` (`YYYY-MM-DD`), for an
   * operator who wants to close the books one period at a time. Omitted means
   * every delivered cash order that is still unpaid.
   */
  before?: string;
}

/** The one predicate both the preview and the write are built from. */
function scopePredicate(scope: CodBackfillScope): SQL {
  const predicates: SQL[] = [
    sql`status = 'delivered'`,
    sql`payment_method = 'cod'`,
    sql`payment_status = 'unpaid'`,
  ];
  if (scope.before !== undefined) {
    predicates.push(sql`delivery_date < ${scope.before}::date`);
  }
  return sql.join(predicates, sql` and `);
}

/**
 * Read-only tally of what the write would touch, grouped per partner and
 * currency (partners bill in NPR or USD, so a single summed figure would be
 * meaningless the day both appear).
 */
export function codDeliveredPreviewSql(scope: CodBackfillScope = {}): SQL {
  return sql`
    select
      partner_id as "partnerId",
      currency,
      count(*)::int as "orders",
      coalesce(sum(total_minor), 0)::text as "totalMinor",
      min(delivery_date)::text as "firstDate",
      max(delivery_date)::text as "lastDate"
    from meal_orders
    where ${scopePredicate(scope)}
    group by partner_id, currency
    order by partner_id, currency
  `;
}

/**
 * Close the payment on those orders. One set-based statement, so it either
 * lands whole or not at all; `status_version` is deliberately NOT bumped
 * because the order's status is not changing, only the payment behind it.
 */
export function codDeliveredBackfillSql(scope: CodBackfillScope = {}): SQL {
  return sql`
    update meal_orders
    set payment_status = 'paid', updated_at = now()
    where ${scopePredicate(scope)}
    returning
      id,
      partner_id as "partnerId",
      currency,
      total_minor as "totalMinor",
      delivery_date::text as "deliveryDate"
  `;
}
