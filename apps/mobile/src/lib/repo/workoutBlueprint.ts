import type { WorkoutExerciseBlueprint, WorkoutSessionBlueprint } from '@gym/shared';

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isExerciseBlueprint(value: unknown): value is WorkoutExerciseBlueprint {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.exerciseId === 'string' &&
    candidate.exerciseId.length > 0 &&
    typeof candidate.exerciseName === 'string' &&
    candidate.exerciseName.length > 0 &&
    isNullableString(candidate.equipment) &&
    typeof candidate.targetSets === 'number' &&
    Number.isInteger(candidate.targetSets) &&
    candidate.targetSets > 0 &&
    isNullableString(candidate.repRange) &&
    typeof candidate.restSec === 'number' &&
    Number.isInteger(candidate.restSec) &&
    candidate.restSec >= 0
  );
}

export function parseWorkoutBlueprintJson(raw: string): WorkoutSessionBlueprint | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const exercises = (value as Record<string, unknown>).exercises;
    if (!Array.isArray(exercises) || !exercises.every(isExerciseBlueprint)) return null;
    return { exercises };
  } catch {
    return null;
  }
}

export function serializeWorkoutBlueprint(blueprint: WorkoutSessionBlueprint): string {
  return JSON.stringify(blueprint);
}
