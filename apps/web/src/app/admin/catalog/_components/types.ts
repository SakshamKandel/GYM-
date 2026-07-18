export interface ExerciseRow {
  id: string;
  name: string;
  muscleGroup: string;
  secondaryMuscles: string[];
  equipment: string | null;
  level: string | null;
  category: string | null;
  instructions: string[];
  imageUrls: string[];
  usedByPlanCount: number;
}

export type PlanTier = 'starter' | 'silver' | 'gold' | 'elite';
export type PlanGoal = 'fat_loss' | 'muscle' | 'strength';

export interface PlanRow {
  id: string;
  name: string;
  tierRequired: PlanTier;
  goalType: PlanGoal;
  weeks: number;
  daysPerWeek: number;
  description: string;
  isBranded: boolean;
  workoutCount: number;
}

export interface PlanExerciseDetail {
  id: string;
  exerciseId: string;
  exerciseName: string | null;
  position: number;
  sets: number;
  repRange: string;
  restSec: number;
}

export interface PlanWorkoutDetail {
  id: string;
  week: number;
  day: number;
  name: string;
  exercises: PlanExerciseDetail[];
}
