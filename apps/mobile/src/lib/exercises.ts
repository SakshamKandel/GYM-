import type { Exercise } from '@gym/shared';
import rawExercises from '../../assets/data/exercises.json';

/**
 * Bundled exercise library — free-exercise-db (873 exercises, Unlicense/public
 * domain). Ships in the app so the library works fully offline; images stream
 * from the jsDelivr CDN and are disk-cached by expo-image.
 */

interface RawExercise {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string | null;
  images: string[];
}

const IMAGE_CDN = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/';

export function exerciseImageUrl(relativePath: string): string {
  return `${IMAGE_CDN}${relativePath}`;
}

function normalize(raw: RawExercise): Exercise {
  return {
    id: raw.id,
    name: raw.name,
    muscleGroup: raw.primaryMuscles[0] ?? 'other',
    secondaryMuscles: raw.secondaryMuscles,
    equipment: raw.equipment || null,
    level: raw.level,
    category: raw.category,
    instructions: raw.instructions,
    imageUrls: raw.images.map(exerciseImageUrl),
  };
}

const ALL: Exercise[] = (rawExercises as RawExercise[]).map(normalize);
const BY_ID = new Map(ALL.map((e) => [e.id, e]));

export function allExercises(): Exercise[] {
  return ALL;
}

export function getExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

export const MUSCLE_GROUPS = [
  'chest', 'lats', 'middle back', 'lower back', 'shoulders', 'traps',
  'biceps', 'triceps', 'forearms', 'quadriceps', 'hamstrings', 'glutes',
  'calves', 'abdominals', 'adductors', 'abductors', 'neck',
] as const;

export interface ExerciseFilter {
  query?: string;
  muscleGroup?: string;
  equipment?: string;
}

export function searchExercises(filter: ExerciseFilter): Exercise[] {
  const q = filter.query?.trim().toLowerCase();
  return ALL.filter((e) => {
    if (filter.muscleGroup && e.muscleGroup !== filter.muscleGroup) return false;
    if (filter.equipment && e.equipment !== filter.equipment) return false;
    if (q && !e.name.toLowerCase().includes(q)) return false;
    return true;
  });
}
