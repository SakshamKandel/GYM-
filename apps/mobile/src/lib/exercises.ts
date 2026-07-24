/** Member exercise reads come only from the validated Neon catalog snapshot. */
export {
  allCatalogExercises as allExercises,
  getCatalogExercise as getExercise,
  searchCatalogExercises as searchExercises,
} from './trainingCatalog';
export type { ExerciseFilter } from './trainingCatalog';

/**
 * Supported anatomy-map groups. This is a UI/body-map vocabulary, not an
 * exercise data source; exercise rows themselves always come from Neon.
 */
export const MUSCLE_GROUPS = [
  'chest', 'lats', 'middle back', 'lower back', 'shoulders', 'traps',
  'biceps', 'triceps', 'forearms', 'quadriceps', 'hamstrings', 'glutes',
  'calves', 'abdominals', 'adductors', 'abductors', 'neck',
] as const;
