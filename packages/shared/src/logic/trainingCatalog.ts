import type { GoalType, TrainingCatalogPlan } from '../types';

/**
 * Select the closest available admin-authored plan without assuming IDs.
 * Goal match wins, then the nearest requested weekly frequency, then name for
 * deterministic ties. If a goal has no published plan, use any available one.
 */
export function selectTrainingPlan(
  plans: readonly TrainingCatalogPlan[],
  goal: GoalType,
  daysPerWeek: number,
): TrainingCatalogPlan | null {
  const available = plans.filter((plan) => plan.isAvailable && plan.workouts.length > 0);
  const goalMatches = available.filter((plan) => plan.goalType === goal);
  const candidates = goalMatches.length > 0 ? goalMatches : available;
  return (
    [...candidates].sort(
      (a, b) =>
        Math.abs(a.daysPerWeek - daysPerWeek) - Math.abs(b.daysPerWeek - daysPerWeek) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}
