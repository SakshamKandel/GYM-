import { sql, type SQL } from 'drizzle-orm';

export type AtomicSubscriptionSkipOutcome =
  | 'inserted'
  | 'duplicate'
  | 'payment_review_required'
  | 'refund_required'
  | 'conflict';

export interface AtomicSubscriptionSkipArgs {
  skipId: string;
  eventId: string;
  subscriptionId: string;
  accountId: string;
  deliveryDate: string;
  weekStart: string;
  window: 'lunch' | 'dinner';
  now: Date;
}

export interface AtomicCycleReceiptArgs {
  requestId: string;
  cycleId: string;
  accountId: string;
  method: 'esewa' | 'khalti';
  receiptUrl: string;
  note: string | null;
}

/** Shared transaction-scoped mutex for skip repricing and cycle receipt submit. */
export function mealCycleOperationLockSql(subscriptionId: string, weekStart: string): SQL {
  const key = `meal-cycle:${subscriptionId}:${weekStart}`;
  return sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/**
 * Insert a subscription skip, reprice its still-unfunded cycle, cancel a
 * materialized pending order, and append the order event in one statement.
 * The cycle/order rows are locked before mutation. A duplicate skip never
 * decrements plannedSlots; pending/approved money prevents every mutation.
 */
export function atomicSubscriptionSkipSql(args: AtomicSubscriptionSkipArgs): SQL {
  return sql`
    with existing_skip as materialized (
      select id
      from meal_sub_skips
      where subscription_id = ${args.subscriptionId}
        and delivery_date = ${args.deliveryDate}
      limit 1
    ),
    target_cycle as materialized (
      select id, status, planned_slots, price_per_day_minor, amount_minor
      from meal_billing_cycles
      where subscription_id = ${args.subscriptionId}
        and week_start = ${args.weekStart}
      limit 1
      for update
    ),
    slot_order as materialized (
      select id, status, payment_status
      from meal_orders
      where subscription_id = ${args.subscriptionId}
        and delivery_date = ${args.deliveryDate}
        and window = ${args.window}
        and source = 'subscription'
        and account_id = ${args.accountId}
      limit 1
      for update
    ),
    payment_block as materialized (
      select case
        when exists (select 1 from existing_skip) then null::text
        when exists (select 1 from slot_order where payment_status = 'paid')
          or exists (select 1 from target_cycle where status = 'paid')
          or exists (
            select 1
            from meal_payment_requests request
            join slot_order order_row on order_row.id = request.order_id
            where request.status = 'approved'
          )
          or exists (
            select 1
            from meal_payment_requests request
            join target_cycle cycle on cycle.id = request.cycle_id
            where request.status = 'approved'
          ) then 'refund_required'
        when exists (select 1 from slot_order where payment_status = 'receipt_submitted')
          or exists (
            select 1
            from meal_payment_requests request
            join slot_order order_row on order_row.id = request.order_id
            where request.status = 'pending'
          )
          or exists (
            select 1
            from meal_payment_requests request
            join target_cycle cycle on cycle.id = request.cycle_id
            where request.status = 'pending'
          ) then 'payment_review_required'
        when exists (select 1 from slot_order where status <> 'pending') then 'conflict'
        else null::text
      end as error
    ),
    inserted_skip as (
      insert into meal_sub_skips (id, subscription_id, delivery_date)
      select ${args.skipId}, ${args.subscriptionId}, ${args.deliveryDate}
      where not exists (select 1 from existing_skip)
        and (select error from payment_block) is null
      on conflict (subscription_id, delivery_date) do nothing
      returning id
    ),
    repriced_cycle as (
      update meal_billing_cycles cycle
      set
        planned_slots = greatest(cycle.planned_slots - 1, 0),
        amount_minor = greatest(cycle.planned_slots - 1, 0) * cycle.price_per_day_minor,
        status = case
          when greatest(cycle.planned_slots - 1, 0) = 0 then 'void'
          else cycle.status
        end,
        updated_at = ${args.now}
      where cycle.id = (select id from target_cycle)
        and cycle.status in ('open', 'awaiting_payment')
        and exists (select 1 from inserted_skip)
      returning cycle.id, cycle.status, cycle.planned_slots, cycle.amount_minor
    ),
    cancelled_order as (
      update meal_orders order_row
      set
        status = 'cancelled',
        status_version = order_row.status_version + 1,
        cancelled_at = ${args.now},
        cancel_reason = 'Skipped by member',
        decided_by = ${args.accountId},
        updated_at = ${args.now}
      where order_row.id = (select id from slot_order)
        and order_row.status = 'pending'
        and order_row.payment_status in ('unpaid', 'refunded')
        and (select error from payment_block) is null
        and (
          exists (select 1 from inserted_skip)
          or exists (select 1 from existing_skip)
        )
      returning order_row.id, order_row.account_id
    ),
    inserted_event as (
      insert into meal_order_events (
        id, order_id, from_status, to_status, actor_id, actor_role
      )
      select ${args.eventId}, id, 'pending', 'cancelled', ${args.accountId}, 'member'
      from cancelled_order
      returning id
    )
    select
      case
        when exists (select 1 from existing_skip) then 'duplicate'
        when (select error from payment_block) is not null then (select error from payment_block)
        when exists (select 1 from inserted_skip) then 'inserted'
        else 'conflict'
      end as outcome,
      (select id from inserted_skip limit 1) as skip_id,
      (select id from repriced_cycle limit 1) as cycle_id,
      (select status from repriced_cycle limit 1) as cycle_status,
      (select planned_slots from repriced_cycle limit 1) as planned_slots,
      (select amount_minor from repriced_cycle limit 1) as amount_minor,
      (select id from cancelled_order limit 1) as cancelled_order_id,
      (select count(*) from inserted_event) as event_count
  `;
}

/**
 * Insert a cycle receipt from the cycle's live amount while holding the same
 * lock as skip repricing. Rejected history is ignored; pending/approved rows
 * remain live blockers.
 */
export function atomicCycleReceiptSql(args: AtomicCycleReceiptArgs): SQL {
  return sql`
    with target_cycle as materialized (
      select id, account_id, amount_minor, currency, status
      from meal_billing_cycles
      where id = ${args.cycleId} and account_id = ${args.accountId}
      limit 1
      for update
    ),
    live_request as materialized (
      select status
      from meal_payment_requests
      where cycle_id = ${args.cycleId} and status in ('pending', 'approved')
    ),
    inserted_request as (
      insert into meal_payment_requests (
        id, account_id, order_id, cycle_id, amount_minor, currency,
        method, receipt_url, note
      )
      select
        ${args.requestId}, cycle.account_id, null, cycle.id,
        cycle.amount_minor, cycle.currency, ${args.method}, ${args.receiptUrl}, ${args.note}
      from target_cycle cycle
      where cycle.status = 'awaiting_payment'
        and cycle.amount_minor > 0
        and not exists (select 1 from live_request)
      returning id, status
    )
    select
      case
        when not exists (select 1 from target_cycle) then 'cycle_not_found'
        when exists (select 1 from live_request where status = 'approved') then 'refund_required'
        when exists (select 1 from live_request where status = 'pending') then 'already_pending'
        when exists (select 1 from target_cycle where status <> 'awaiting_payment' or amount_minor <= 0)
          then 'cycle_not_payable'
        when exists (select 1 from inserted_request) then 'inserted'
        else 'conflict'
      end as outcome,
      (select id from inserted_request limit 1) as request_id,
      (select status from inserted_request limit 1) as request_status
  `;
}
