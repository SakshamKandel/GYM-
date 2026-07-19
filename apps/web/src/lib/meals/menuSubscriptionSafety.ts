import { sql, type SQL } from 'drizzle-orm';

/**
 * Permanently hide a menu item only when no live fixed plan selects it. The
 * caller runs this after partnerOperationLockSql(partnerId), which is also used
 * by subscription create/edit, so a new reference and removal cannot cross.
 */
export function guardedMealSoftDeleteSql(params: {
  mealId: string;
  partnerId: string;
  now: Date;
}): SQL {
  return sql`
    with target_meal as materialized (
      select meal.id
      from meals meal
      where meal.id = ${params.mealId}
        and meal.partner_id = ${params.partnerId}
        and meal.is_deleted = false
      limit 1
      for update
    ),
    blockers as materialized (
      select count(*)::integer as count
      from meal_subscriptions subscription
      where subscription.meal_id = ${params.mealId}
        and subscription.partner_id = ${params.partnerId}
        and subscription.plan_type = 'fixed_meal'
        and subscription.status in ('active', 'paused')
    ),
    deleted as (
      update meals meal
      set is_deleted = true, is_active = false, updated_at = ${params.now}
      where meal.id = (select id from target_meal)
        and (select count from blockers) = 0
      returning meal.id
    )
    select
      case
        when not exists (select 1 from target_meal) then 'not_found'
        when (select count from blockers) > 0 then 'fixed_subscription_in_use'
        when exists (select 1 from deleted) then 'deleted'
        else 'conflict'
      end as outcome,
      (select count from blockers) as subscription_count
  `;
}
