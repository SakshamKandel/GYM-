import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { todayIso } from '../lib/dates';
import { mmkvStorage } from '../lib/mmkvStorage';
import { questScopeId } from './questScope';

export { questScopeId } from './questScope';

/** Persisted first-workouts quest values for exactly one account scope. */
export interface QuestAccountState {
  questStartIso: string | null;
  reminderScheduled: boolean;
  dismissed: boolean;
}

const EMPTY_QUEST: QuestAccountState = {
  questStartIso: null,
  reminderScheduled: false,
  dismissed: false,
};

export interface QuestState {
  quests: Record<string, QuestAccountState>;
  ensureStarted: (accountId: string | null | undefined) => void;
  setReminderScheduled: (accountId: string | null | undefined, scheduled: boolean) => void;
  setDismissed: (accountId: string | null | undefined, dismissed: boolean) => void;
}

/** Read only the requested account's quest; a different account falls back empty. */
export function questStateFor(
  state: Pick<QuestState, 'quests'>,
  accountId: string | null | undefined,
): QuestAccountState {
  return state.quests[questScopeId(accountId)] ?? EMPTY_QUEST;
}

export const useQuest = create<QuestState>()(
  persist(
    (set, get) => ({
      quests: {},

      ensureStarted: (accountId) => {
        const scope = questScopeId(accountId);
        const current = get().quests[scope] ?? EMPTY_QUEST;
        if (current.questStartIso !== null) return;
        set((state) => ({
          quests: {
            ...state.quests,
            [scope]: { ...current, questStartIso: todayIso() },
          },
        }));
      },

      setReminderScheduled: (accountId, reminderScheduled) => {
        const scope = questScopeId(accountId);
        set((state) => ({
          quests: {
            ...state.quests,
            [scope]: {
              ...(state.quests[scope] ?? EMPTY_QUEST),
              reminderScheduled,
            },
          },
        }));
      },

      setDismissed: (accountId, dismissed) => {
        const scope = questScopeId(accountId);
        set((state) => ({
          quests: {
            ...state.quests,
            [scope]: { ...(state.quests[scope] ?? EMPTY_QUEST), dismissed },
          },
        }));
      },
    }),
    {
      // v1 stored one device-global quest. Start a clean keyed cache instead
      // of guessing which member owned those legacy values.
      name: 'gym-tracker-quest-v2',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({ quests: state.quests }),
    },
  ),
);
