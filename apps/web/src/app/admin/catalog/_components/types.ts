/**
 * One exercise as the console LIST shows it.
 *
 * The three long array fields (secondary muscles, instruction text, image urls)
 * are deliberately NOT here: no column renders them, and across the whole
 * library they are the bulk of the page. They are fetched for the single row
 * being edited instead — see {@link ExerciseDetail}.
 */
export interface ExerciseRow {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string | null;
  level: string | null;
  category: string | null;
  usedByPlanCount: number;
}

/**
 * The rest of one exercise, loaded on demand when the edit form opens
 * (GET /admin/catalog/exercise-detail?id=…). Until it arrives the form's
 * textareas stay empty and saving is held back, so a save can never write an
 * empty list over text that simply had not loaded yet.
 */
export interface ExerciseDetail {
  secondaryMuscles: string[];
  instructions: string[];
  imageUrls: string[];
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
