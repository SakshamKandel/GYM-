import { mealDeliveryConfig } from '@gym/db';
import { DEFAULT_MEAL_DELIVERY_CONFIG, type MealDeliveryConfig } from '@gym/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '@gym/db';

/**
 * Loads the server-authoritative fee + cutoff parameters from the singleton
 * `meal_delivery_config` row (id='singleton'). The client NEVER sets fees, price
 * or cutoffs (§3) — every fee computation and cutoff resolution reads from here.
 *
 * The row is created by the admin config editor; until then (fresh install) we
 * fall back to the frozen defaults in @gym/shared, which mirror the column
 * defaults exactly. This is a pure read — it never writes on the request path.
 */
export async function loadDeliveryConfig(db: Db): Promise<MealDeliveryConfig> {
  const rows = await db
    .select({
      smallOrderFeeMinor: mealDeliveryConfig.smallOrderFeeMinor,
      smallOrderThresholdMinor: mealDeliveryConfig.smallOrderThresholdMinor,
      deliveryFeeMinor: mealDeliveryConfig.deliveryFeeMinor,
      freeDeliveryThresholdMinor: mealDeliveryConfig.freeDeliveryThresholdMinor,
      lunchCutoffPrevDayHour: mealDeliveryConfig.lunchCutoffPrevDayHour,
      dinnerCutoffSameDayHour: mealDeliveryConfig.dinnerCutoffSameDayHour,
    })
    .from(mealDeliveryConfig)
    .where(eq(mealDeliveryConfig.id, 'singleton'))
    .limit(1);
  return rows[0] ?? DEFAULT_MEAL_DELIVERY_CONFIG;
}
