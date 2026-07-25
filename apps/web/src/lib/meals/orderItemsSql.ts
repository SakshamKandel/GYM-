import type { MealMacrosSnapshot } from '@gym/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Race-safe line-item backfill for a materialized subscription order (P1-4).
 *
 * neon-http has no interactive transactions, so the materializer's order insert
 * and its item insert are two statements: a crash between them leaves an itemless
 * order, and the recovery path used to be a read-then-write ("select an item →
 * none → insert"). Two materializers racing the same order (member read, partner
 * queue read, admin board read all trigger materialization) could both read
 * "no items" and both insert, duplicating the line — which duplicates the
 * displayed order content and any per-item math built on it.
 *
 * The insert is now conditional IN SQL (`insert … select … where not exists`),
 * the same guarded pattern `atomicSubscriptionSkipSql` uses. Because READ
 * COMMITTED fixes a statement's snapshot before it blocks, the conditional alone
 * is not enough: callers MUST run {@link mealOrderItemsLockSql} as a SEPARATE
 * preceding statement in the same batch/transaction, exactly like the partner
 * operation lock in the one-time order path — the waiter then takes a fresh
 * snapshot after acquiring the lock and correctly observes the winner's row.
 */

export interface GuardedOrderItemInsertArgs {
  itemId: string;
  orderId: string;
  mealId: string;
  nameSnapshot: string;
  priceMinorSnapshot: number;
  macrosSnapshot: MealMacrosSnapshot;
  qty: number;
}

/** Transaction-scoped mutex over one order's line items. */
export function mealOrderItemsLockSql(orderId: string): SQL {
  const key = `meal-order-items:${orderId}`;
  return sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Insert the line item only while the order still has none. */
export function guardedOrderItemInsertSql(args: GuardedOrderItemInsertArgs): SQL {
  const macros = JSON.stringify(args.macrosSnapshot);
  return sql`
    insert into meal_order_items (
      id, order_id, meal_id, name_snapshot, price_minor_snapshot, macros_snapshot, qty
    )
    select
      ${args.itemId}, ${args.orderId}, ${args.mealId}, ${args.nameSnapshot},
      ${args.priceMinorSnapshot}, ${macros}::jsonb, ${args.qty}
    where not exists (
      select 1 from meal_order_items existing where existing.order_id = ${args.orderId}
    )
    returning id
  `;
}
