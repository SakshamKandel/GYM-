import { mealAvailability, type Db } from '@gym/db';
import { ktmDayOfWeek, type MealWindow } from '@gym/shared';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Which of `mealIds` the partner has flagged SOLD OUT for one delivery slot
 * (P1-7). `meal_availability.soldOut` is per (meal, dayOfWeek, window), so the
 * KTM delivery date resolves to the day-of-week the flag is stored against.
 *
 * The member menu already returns `soldOut` and the app renders it, and the
 * atomic order write refuses a sold-out line under the partner mutex. This is
 * the read a checkout pre-flight uses so the member gets the precise
 * `meal_unavailable_for_slot` answer instead of a generic refusal.
 */
export async function soldOutMealIdsForSlot(
  db: Db,
  mealIds: readonly string[],
  deliveryDate: string,
  window: MealWindow,
): Promise<Set<string>> {
  if (mealIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ mealId: mealAvailability.mealId })
    .from(mealAvailability)
    .where(
      and(
        inArray(mealAvailability.mealId, [...mealIds]),
        eq(mealAvailability.dayOfWeek, ktmDayOfWeek(deliveryDate)),
        eq(mealAvailability.window, window),
        eq(mealAvailability.soldOut, true),
      ),
    );
  return new Set(rows.map((row) => row.mealId));
}
