import { sql, type SQL } from 'drizzle-orm';
import type { CycleAdjustment, SubscriptionPlanShape } from './subscriptionPlan';

export interface AtomicSubscriptionCreateArgs {
  id: string;
  accountId: string;
  partnerId: string;
  shape: SubscriptionPlanShape;
  pricePerDayMinor: number;
  currency: 'NPR' | 'USD';
  paymentMethod: 'esewa' | 'khalti' | 'cod';
  startDate: string;
}

/**
 * Create from live rows after the caller has acquired partnerOperationLockSql.
 * The fixed-meal predicate closes the validate-then-soft-delete race.
 */
export function atomicSubscriptionCreateSql(args: AtomicSubscriptionCreateArgs): SQL {
  return sql`
    insert into meal_subscriptions (
      id, account_id, partner_id, days_of_week, window, plan_type, meal_id,
      address_id, price_per_day_minor, currency, payment_method, start_date,
      status
    )
    select
      ${args.id}, ${args.accountId}, ${args.partnerId}, ${args.shape.daysOfWeek},
      ${args.shape.window}, ${args.shape.planType}, ${args.shape.mealId},
      ${args.shape.addressId}, ${args.pricePerDayMinor}, ${args.currency},
      ${args.paymentMethod}, ${args.startDate}, 'active'
    where exists (
      select 1
      from meal_partners partner
      where partner.id = ${args.partnerId}
        and partner.is_active = true
        and partner.accepting_orders = true
    )
      and exists (
        select 1
        from saved_addresses address
        where address.id = ${args.shape.addressId}
          and address.account_id = ${args.accountId}
          and address.is_deleted = false
      )
      and (
        ${args.shape.planType} = 'partner_rotating'
        or exists (
          select 1
          from meals meal
          where meal.id = ${args.shape.mealId}
            and meal.partner_id = ${args.partnerId}
            and meal.is_active = true
            and meal.is_deleted = false
        )
      )
    returning id
  `;
}

export interface AtomicSubscriptionEditArgs {
  subscriptionId: string;
  accountId: string;
  partnerId: string;
  expectedUpdatedAt: Date;
  now: Date;
  today: string;
  shape: SubscriptionPlanShape;
  pricePerDayMinor: number;
  currency: 'NPR' | 'USD';
  cycleAdjustments: CycleAdjustment[];
}

export type AtomicSubscriptionEditOutcome =
  | 'updated'
  | 'not_found'
  | 'not_active'
  | 'meal_unavailable'
  | 'address_not_found'
  | 'payment_review_required'
  | 'refund_required'
  | 'conflict';

/**
 * Commit a member plan edit and every future unfunded cycle reprice in one SQL
 * statement. Existing orders are deliberately immutable snapshots. The CTE:
 *
 *  - takes the same partner mutex as permanent menu removal;
 *  - takes the same per-cycle mutex as skip + receipt submission;
 *  - locks the subscription/cycle/order rows;
 *  - blocks paid or under-review future money;
 *  - CAS-checks the subscription and every pre-quoted cycle;
 *  - re-validates the selected live meal and owner-scoped address.
 */
export function atomicSubscriptionEditSql(args: AtomicSubscriptionEditArgs): SQL {
  const adjustments = JSON.stringify(
    args.cycleAdjustments.map((adjustment) => ({
      id: adjustment.id,
      expected_status: adjustment.expectedStatus,
      expected_planned_slots: adjustment.expectedPlannedSlots,
      expected_updated_at: adjustment.expectedUpdatedAt.toISOString(),
      planned_slots: adjustment.plannedSlots,
      next_status: adjustment.nextStatus,
      amount_minor: adjustment.amountMinor,
    })),
  );

  return sql`
    with partner_lock as materialized (
      select pg_advisory_xact_lock(hashtextextended(${args.partnerId}, 0))
    ),
    cycle_locks as materialized (
      select pg_advisory_xact_lock(
        hashtextextended(
          'meal-cycle:' || cycle.subscription_id || ':' || cycle.week_start::text,
          0
        )
      )
      from meal_billing_cycles cycle
      where cycle.subscription_id = ${args.subscriptionId}
        and cycle.week_end >= ${args.today}
      order by cycle.week_start
    ),
    target_sub as materialized (
      select sub.id, sub.status, sub.updated_at
      from meal_subscriptions sub
      where sub.id = ${args.subscriptionId}
        and sub.account_id = ${args.accountId}
        and (select count(*) from partner_lock) = 1
        and (select count(*) from cycle_locks) >= 0
      limit 1
      for update
    ),
    future_cycles as materialized (
      select cycle.id, cycle.status, cycle.planned_slots, cycle.updated_at
      from meal_billing_cycles cycle
      where cycle.subscription_id = ${args.subscriptionId}
        and cycle.week_end >= ${args.today}
      for update
    ),
    future_orders as materialized (
      select order_row.id, order_row.payment_status, order_row.delivery_date
      from meal_orders order_row
      where order_row.subscription_id = ${args.subscriptionId}
        and order_row.delivery_date >= ${args.today}
      for update
    ),
    protected_requests as materialized (
      select request.status
      from meal_payment_requests request
      where request.status in ('pending', 'approved')
        and (
          request.order_id in (select id from future_orders)
          or request.cycle_id in (select id from future_cycles)
        )
    ),
    payment_block as materialized (
      select case
        when exists (select 1 from future_orders where payment_status = 'paid')
          or exists (select 1 from future_cycles where status = 'paid')
          or exists (select 1 from protected_requests where status = 'approved')
          then 'refund_required'
        when exists (select 1 from future_orders where payment_status = 'receipt_submitted')
          or exists (select 1 from protected_requests where status = 'pending')
          then 'payment_review_required'
        else null::text
      end as error
    ),
    adjustments as materialized (
      select *
      from jsonb_to_recordset(${adjustments}::jsonb) as adjustment(
        id text,
        expected_status text,
        expected_planned_slots integer,
        expected_updated_at timestamptz,
        planned_slots integer,
        next_status text,
        amount_minor integer
      )
    ),
    editable_cycles as materialized (
      select cycle.*
      from future_cycles cycle
      where cycle.status in ('open', 'awaiting_payment', 'void')
    ),
    cycle_state as materialized (
      select not (
        (select count(*) from editable_cycles) = (select count(*) from adjustments)
        and not exists (
          select 1
          from editable_cycles cycle
          full join adjustments adjustment on adjustment.id = cycle.id
          where cycle.id is null
            or adjustment.id is null
            or cycle.status <> adjustment.expected_status
            or cycle.planned_slots <> adjustment.expected_planned_slots
            or cycle.updated_at <> adjustment.expected_updated_at
        )
      ) as mismatched
    ),
    live_shape as materialized (
      select
        exists (
          select 1
          from saved_addresses address
          where address.id = ${args.shape.addressId}
            and address.account_id = ${args.accountId}
            and address.is_deleted = false
        ) as address_ok,
        (
          ${args.shape.planType} = 'partner_rotating'
          or exists (
            select 1
            from meals meal
            where meal.id = ${args.shape.mealId}
              and meal.partner_id = ${args.partnerId}
              and meal.is_active = true
              and meal.is_deleted = false
          )
        ) as meal_ok
    ),
    updated_sub as (
      update meal_subscriptions sub
      set
        days_of_week = ${args.shape.daysOfWeek},
        window = ${args.shape.window},
        plan_type = ${args.shape.planType},
        meal_id = ${args.shape.mealId},
        address_id = ${args.shape.addressId},
        price_per_day_minor = ${args.pricePerDayMinor},
        currency = ${args.currency},
        updated_at = ${args.now}
      where sub.id = (select id from target_sub)
        and sub.account_id = ${args.accountId}
        and sub.status in ('active', 'paused')
        and sub.updated_at = ${args.expectedUpdatedAt}
        and (select error from payment_block) is null
        and not (select mismatched from cycle_state)
        and (select address_ok from live_shape)
        and (select meal_ok from live_shape)
      returning sub.id, sub.status
    ),
    inserted_preservation_skips as (
      insert into meal_sub_skips (id, subscription_id, delivery_date)
      select
        'plan-edit-' || md5(${args.subscriptionId} || ':' || delivery_date::text),
        ${args.subscriptionId},
        delivery_date
      from future_orders
      where exists (select 1 from updated_sub)
      on conflict (subscription_id, delivery_date) do nothing
      returning id
    ),
    updated_cycles as (
      update meal_billing_cycles cycle
      set
        planned_slots = adjustment.planned_slots,
        price_per_day_minor = ${args.pricePerDayMinor},
        currency = ${args.currency},
        amount_minor = adjustment.amount_minor,
        status = adjustment.next_status,
        updated_at = ${args.now}
      from adjustments adjustment
      where cycle.id = adjustment.id
        and exists (select 1 from updated_sub)
      returning cycle.id
    )
    select
      case
        when not exists (select 1 from target_sub) then 'not_found'
        when exists (select 1 from target_sub where status = 'cancelled') then 'not_active'
        when (select error from payment_block) is not null then (select error from payment_block)
        when not (select address_ok from live_shape) then 'address_not_found'
        when not (select meal_ok from live_shape) then 'meal_unavailable'
        when exists (select 1 from updated_sub)
          and (select count(*) from updated_cycles) = (select count(*) from adjustments)
          then 'updated'
        else 'conflict'
      end as outcome,
      (select status from updated_sub limit 1) as status,
      (select count(*) from inserted_preservation_skips) as preservation_skip_count,
      coalesce(
        (select array_agg(distinct delivery_date::text order by delivery_date::text) from future_orders),
        array[]::text[]
      ) as preserved_order_dates
  `;
}
