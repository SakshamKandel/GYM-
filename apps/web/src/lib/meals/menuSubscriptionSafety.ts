import type { MealCurrency, MealDietType, MealGoalTag } from '@gym/shared';
import { sql, type SQL } from 'drizzle-orm';
import { pgTextArray } from './pgArray.ts';

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

/** The editable columns of a menu item — mirrors the partner PATCH payload. */
export interface MealPatchFields {
  name?: string;
  description?: string;
  imageUrl?: string | null;
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number | null;
  sugarG?: number | null;
  dietType?: MealDietType;
  goalTags?: MealGoalTag[];
  priceMinor?: number;
  currency?: MealCurrency;
  isActive?: boolean;
  sortOrder?: number;
}

/** Patch field → physical column. The ONLY columns this statement may write. */
const MEAL_PATCH_COLUMNS: readonly (readonly [keyof MealPatchFields, string])[] = [
  ['name', 'name'],
  ['description', 'description'],
  ['imageUrl', 'image_url'],
  ['kcal', 'kcal'],
  ['proteinG', 'protein_g'],
  ['carbsG', 'carbs_g'],
  ['fatG', 'fat_g'],
  ['fiberG', 'fiber_g'],
  ['sugarG', 'sugar_g'],
  ['dietType', 'diet_type'],
  ['goalTags', 'goal_tags'],
  ['priceMinor', 'price_minor'],
  ['currency', 'currency'],
  ['isActive', 'is_active'],
  ['sortOrder', 'sort_order'],
];

/**
 * Apply a partner menu-item PATCH, refusing the ACTIVE→INACTIVE step while a
 * live fixed-meal plan still selects the item.
 *
 * Taking a dish off the menu has always been guarded on the DELETE path, but
 * `PATCH {isActive:false}` walked straight past it — and a deactivated meal
 * resolves to null in the materializer, so the subscriber's deliveries silently
 * stop while their weekly billing carries on. Same blocker query, same
 * `partnerOperationLockSql(partnerId)` mutex as the soft delete (so a new
 * subscription and a deactivation cannot cross), same 'fixed_subscription_in_use'
 * conflict shape with the subscriber count.
 *
 * Nothing else is blocked: the blocker count is only computed when the row is
 * CURRENTLY active, so re-sending `isActive:false` on an already-inactive item,
 * or editing price/macros/photo/sort order, applies exactly as before. All
 * requested columns move in this single statement — a refused deactivation
 * writes nothing at all.
 */
export function guardedMealPatchSql(params: {
  mealId: string;
  partnerId: string;
  now: Date;
  patch: MealPatchFields;
}): SQL {
  const assignments: SQL[] = [];
  for (const [key, column] of MEAL_PATCH_COLUMNS) {
    const value = params.patch[key];
    if (value === undefined) continue;
    // goalTags is the one array column: it MUST go through pgTextArray, since a
    // raw array param renders as a row constructor, not an array.
    assignments.push(
      Array.isArray(value)
        ? sql`${sql.identifier(column)} = ${pgTextArray(value)}`
        : sql`${sql.identifier(column)} = ${value}`,
    );
  }
  assignments.push(sql`updated_at = ${params.now}`);

  // The in-use check only applies when this PATCH actually turns a live item
  // off; every other edit (including a no-op re-deactivate on an already
  // inactive row) resolves to count 0 and updates normally.
  const blockers =
    params.patch.isActive === false
      ? sql`
          select count(*)::integer as count
          from meal_subscriptions subscription
          where exists (select 1 from target_meal where is_active = true)
            and subscription.meal_id = ${params.mealId}
            and subscription.partner_id = ${params.partnerId}
            and subscription.plan_type = 'fixed_meal'
            and subscription.status in ('active', 'paused')
        `
      : sql`select 0::integer as count`;

  return sql`
    with target_meal as materialized (
      select meal.id, meal.is_active
      from meals meal
      where meal.id = ${params.mealId}
        and meal.partner_id = ${params.partnerId}
        and meal.is_deleted = false
      limit 1
      for update
    ),
    blockers as materialized (
      ${blockers}
    ),
    updated as (
      update meals meal
      set ${sql.join(assignments, sql`, `)}
      where meal.id = (select id from target_meal)
        and (select count from blockers) = 0
      returning meal.id
    )
    select
      case
        when not exists (select 1 from target_meal) then 'not_found'
        when (select count from blockers) > 0 then 'fixed_subscription_in_use'
        when exists (select 1 from updated) then 'updated'
        else 'conflict'
      end as outcome,
      (select count from blockers) as subscription_count
  `;
}
