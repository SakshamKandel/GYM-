import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { nowIso } from '../../lib/dates';
import { uid } from '../../lib/id';
import { mmkvStorage } from '../../lib/mmkvStorage';
import { useAuth } from '../../state/auth';

/**
 * Custom workout templates — user-saved rotations that live next to the
 * catalog plans (loaded from Neon via the training catalog) on the Train tab.
 * Persisted locally so templates survive restarts and work fully offline.
 *
 * Fingerprinted to an account id like the other per-account stores
 * (gamification badges, check-in): this blob outlives sign-out, so without a
 * stamp one member's saved templates show up — and can be started — under the
 * next person to sign in on a shared phone. Rules:
 *  - same account → untouched.
 *  - UNSTAMPED blob (an install from before this scoping, or templates saved
 *    while signed out) → adopted by whoever reads it first, so the ordinary
 *    single-user upgrade keeps every template it had.
 *  - different account → reset, and the new owner starts empty.
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
  /** The account these templates belong to; null = never stamped (see above). */
  accountId: string | null;

  /**
   * Reconcile the persisted blob with `accountId` (adopt when unstamped,
   * reset on a mismatch). Idempotent — safe to call on every render pass.
   */
  syncAccount: (accountId: string | null) => void;
  /** Newest first. Blank names fall back to "My workout". */
  saveTemplate: (name: string, exercises: CustomTemplateExercise[]) => CustomTemplate;
  renameTemplate: (id: string, name: string) => void;
  deleteTemplate: (id: string) => void;
}

/** The signed-in account id, or null when signed out. */
function currentAccountId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/** Stable empty result — a fresh [] per read would re-render on every tick. */
const NO_TEMPLATES: CustomTemplate[] = [];

/**
 * Templates that belong to `accountId`. An unstamped blob reads through (it
 * gets adopted by `syncAccount`); another account's templates read as empty
 * even before the reset lands, so a stale list can never flash on screen.
 */
export function templatesFor(
  state: Pick<TemplatesStore, 'templates' | 'accountId'>,
  accountId: string | null,
): CustomTemplate[] {
  if (state.accountId === null || state.accountId === accountId) return state.templates;
  return NO_TEMPLATES;
}

export const useTemplates = create<TemplatesStore>()(
  persist(
    (set, get) => ({
      templates: [],
      accountId: null,

      syncAccount: (accountId) => {
        const state = get();
        if (state.accountId === accountId) return;
        // Unstamped: adopt rather than drop — this is the single-user install
        // upgrading into scoping, and its templates are genuinely theirs.
        if (state.accountId === null) {
          set({ accountId });
          return;
        }
        set({ accountId, templates: [] });
      },

      saveTemplate: (name, exercises) => {
        // Stamp before writing, so a template saved right after a sign-in
        // can't land in (or resurrect) the previous account's list.
        get().syncAccount(currentAccountId());
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
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);

/**
 * The signed-in account's templates. Reads through the scope selector (so the
 * very first render is already correct) and reconciles the persisted stamp in
 * an effect.
 */
export function useAccountTemplates(): CustomTemplate[] {
  const accountId = useAuth((s) => s.user?.id ?? null);
  const templates = useTemplates((s) => templatesFor(s, accountId));

  useEffect(() => {
    useTemplates.getState().syncAccount(accountId);
  }, [accountId]);

  return templates;
}
