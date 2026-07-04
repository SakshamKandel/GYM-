import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { nowIso } from '../../lib/dates';
import { uid } from '../../lib/id';

/**
 * Custom workout templates — user-saved rotations that live next to the seed
 * plans on the Train tab. Persisted locally (same pattern as the buddy cache)
 * so templates survive restarts and work fully offline.
 */

export interface CustomTemplateExercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  repRange: string | null;
  restSec: number;
}

export interface CustomTemplate {
  id: string;
  name: string;
  createdAt: string; // ISO datetime
  exercises: CustomTemplateExercise[];
}

interface TemplatesStore {
  templates: CustomTemplate[];

  /** Newest first. Blank names fall back to "My workout". */
  saveTemplate: (name: string, exercises: CustomTemplateExercise[]) => CustomTemplate;
  renameTemplate: (id: string, name: string) => void;
  deleteTemplate: (id: string) => void;
}

export const useTemplates = create<TemplatesStore>()(
  persist(
    (set) => ({
      templates: [],

      saveTemplate: (name, exercises) => {
        const template: CustomTemplate = {
          id: uid(),
          name: name.trim() || 'My workout',
          createdAt: nowIso(),
          exercises,
        };
        set((s) => ({ templates: [template, ...s.templates] }));
        return template;
      },

      renameTemplate: (id, name) =>
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === id ? { ...t, name: name.trim() || t.name } : t,
          ),
        })),

      deleteTemplate: (id) =>
        set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),
    }),
    {
      name: 'gym-tracker-templates-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
