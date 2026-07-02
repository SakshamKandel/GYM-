import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { todayIso } from '../lib/dates';

/**
 * First-3-workouts activation quest — tiny persisted slice.
 *
 * `questStartIso` anchors the 14-day activation window. It's lazily set to
 * today the first time the quest is read (see `useQuest`), so the countdown
 * begins when the user actually sees the card, not at install time.
 */

export interface QuestState {
  /** Day the quest window began (ISO yyyy-mm-dd). null until first read. */
  questStartIso: string | null;
  /** Whether the one local reminder has already been scheduled. */
  reminderScheduled: boolean;
  /** User dismissed the (completed) quest card. */
  dismissed: boolean;

  /** Set the start day once; a no-op if already set. */
  ensureStarted: () => void;
  setReminderScheduled: (scheduled: boolean) => void;
  setDismissed: (dismissed: boolean) => void;
}

export const useQuest = create<QuestState>()(
  persist(
    (set, get) => ({
      questStartIso: null,
      reminderScheduled: false,
      dismissed: false,

      ensureStarted: () => {
        if (get().questStartIso === null) set({ questStartIso: todayIso() });
      },
      setReminderScheduled: (reminderScheduled) => set({ reminderScheduled }),
      setDismissed: (dismissed) => set({ dismissed }),
    }),
    {
      name: 'gym-tracker-quest-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
