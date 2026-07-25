import {
  accounts,
  type CoachAssignedWorkoutItem,
  type CoachDietPlanItem,
  type CoachDietPlanMeal,
} from '@gym/db';
import { effectiveTier, hasEntitlement, maskPii } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { getDb } from './db';

/**
 * The two rules every coach-authored-content route has to apply identically:
 * "may this client be given this?" and "mask the free text before it is
 * stored". Both were copy-pasted across the four coach workout/diet routes
 * (clients/[userId]/workouts, clients/[userId]/diet-plans, workouts/[id],
 * diet-plans/[id]), which meant the PII mask and the tier floor each had four
 * places to drift. They live here now so a change lands everywhere at once.
 */

/**
 * The client's tier RIGHT NOW (a lapsed paid window reads as starter, the same
 * collapse the member's own app applies), or 'starter' when the account can't
 * be read at all — an unknown client must never unlock a paid write.
 */
export async function clientCanReceive(
  userId: string,
  feature: 'coach_workouts' | 'coach_diet',
): Promise<boolean> {
  const [client] = await getDb()
    .select({ tier: accounts.tier, tierExpiresAt: accounts.tierExpiresAt })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .limit(1);
  const tier = client ? effectiveTier(client.tier, client.tierExpiresAt, new Date()) : 'starter';
  return hasEntitlement({ tier }, feature);
}

/** Masks every client-visible free-text field of one program item. */
export function maskWorkoutItem(item: CoachAssignedWorkoutItem): CoachAssignedWorkoutItem {
  return {
    ...item,
    name: maskPii(item.name),
    repRange: maskPii(item.repRange),
    note: item.note !== undefined ? maskPii(item.note) : undefined,
  };
}

/** Masks every client-visible free-text field of one food item. */
export function maskDietItem(item: CoachDietPlanItem): CoachDietPlanItem {
  return {
    ...item,
    name: maskPii(item.name),
    qty: maskPii(item.qty),
    note: item.note !== undefined ? maskPii(item.note) : undefined,
  };
}

export function maskDietMeal(meal: CoachDietPlanMeal): CoachDietPlanMeal {
  return { ...meal, items: meal.items.map(maskDietItem) };
}
