import { MUSCLE_GROUPS } from './exercises';
import type { MuscleMapSide } from './muscleMapData';

/**
 * Shared muscle-map vocabulary: how the app's exercise muscle groups map onto
 * the MuscleMapJS anatomy path slugs (lib/muscleMapData.ts) and back. Lives in
 * lib/ so any feature (training, anatomy, analytics) can use it without
 * importing across feature modules (CLAUDE.md rule 2).
 */

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  lats: 'Lats',
  'middle back': 'Middle back',
  'lower back': 'Lower back',
  shoulders: 'Shoulders',
  traps: 'Traps',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quadriceps: 'Quadriceps',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  abdominals: 'Abdominals',
  adductors: 'Adductors',
  abductors: 'Abductors',
  neck: 'Neck',
};

/** App exercise labels map onto MuscleMapJS's anatomy names. */
export const SOURCE_MUSCLES: Record<MuscleGroup, readonly string[]> = {
  chest: ['chest'],
  lats: ['upper-back'],
  // MuscleMapJS's male body model does not include a separate rhomboid path;
  // its upper-back region covers the mid-back visual area.
  'middle back': ['upper-back'],
  'lower back': ['lower-back'],
  shoulders: ['deltoids', 'rotator-cuff'],
  traps: ['trapezius'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearm'],
  quadriceps: ['quadriceps', 'hip-flexors'],
  hamstrings: ['hamstring'],
  glutes: ['gluteal'],
  calves: ['calves'],
  abdominals: ['abs', 'obliques', 'serratus'],
  adductors: ['adductors'],
  abductors: ['hip-flexors', 'gluteal'],
  neck: ['neck'],
};

/** Which body side shows a muscle best when it is selected programmatically. */
export const PREFERRED_SIDE: Record<MuscleGroup, MuscleMapSide> = {
  chest: 'front',
  lats: 'back',
  'middle back': 'back',
  'lower back': 'back',
  shoulders: 'front',
  traps: 'back',
  biceps: 'front',
  triceps: 'back',
  forearms: 'front',
  quadriceps: 'front',
  hamstrings: 'back',
  glutes: 'back',
  calves: 'back',
  abdominals: 'front',
  adductors: 'front',
  abductors: 'front',
  neck: 'back',
};

export const SOURCE_TO_APP_MUSCLE: Record<string, MuscleGroup> = {
  chest: 'chest',
  'upper-back': 'lats',
  rhomboids: 'middle back',
  'lower-back': 'lower back',
  deltoids: 'shoulders',
  'rotator-cuff': 'shoulders',
  trapezius: 'traps',
  biceps: 'biceps',
  triceps: 'triceps',
  forearm: 'forearms',
  quadriceps: 'quadriceps',
  'hip-flexors': 'abductors',
  hamstring: 'hamstrings',
  gluteal: 'glutes',
  calves: 'calves',
  abs: 'abdominals',
  obliques: 'abdominals',
  serratus: 'abdominals',
  adductors: 'adductors',
  neck: 'neck',
};

/** Path groups that render the body outline but are not selectable muscles. */
export const VISUAL_ONLY_SLUGS = new Set([
  'head',
  'hair',
  'hands',
  'feet',
  'knees',
  'tibialis',
  'ankles',
]);

export function isMuscleGroup(value: string): value is MuscleGroup {
  return MUSCLE_GROUPS.some((group) => group === value);
}
