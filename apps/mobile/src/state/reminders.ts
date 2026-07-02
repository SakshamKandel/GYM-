import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Reminder preferences — the small persisted slice behind the Settings
 * "Reminders" section. Everything here drives LOCAL, recurring notifications
 * (see scheduleWorkoutReminders / scheduleMorningNudge / scheduleCheckInReminder
 * in src/lib/notifications.ts); no server involved.
 *
 * Weekdays use the expo-notifications convention: 1 = Sunday … 7 = Saturday.
 */

/** expo-notifications weekday numbers: 1 = Sunday, 7 = Saturday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface RemindersState {
  /** Master switch for the per-weekday workout reminders. */
  workoutRemindersOn: boolean;
  /** Selected weekdays (1=Sun … 7=Sat). Empty = none scheduled. */
  weekdays: number[];
  /** Fire hour for the workout reminders (0–23). */
  hour: number;
  /** Fire minute for the workout reminders (0–59). */
  minute: number;
  /** Daily "ready to train?" morning nudge. */
  morningNudgeOn: boolean;
  /** Weekly Sunday-morning GM check-in reminder. */
  checkInReminderOn: boolean;

  setWorkoutRemindersOn: (on: boolean) => void;
  setWeekdays: (weekdays: number[]) => void;
  toggleWeekday: (weekday: number) => void;
  setTime: (hour: number, minute: number) => void;
  setMorningNudgeOn: (on: boolean) => void;
  setCheckInReminderOn: (on: boolean) => void;
}

/** Mon–Fri sample so the day picker isn't empty on first open. */
const DEFAULT_WEEKDAYS: number[] = [2, 3, 4, 5, 6];

export const useReminders = create<RemindersState>()(
  persist(
    (set) => ({
      workoutRemindersOn: false,
      weekdays: DEFAULT_WEEKDAYS,
      hour: 18,
      minute: 0,
      morningNudgeOn: false,
      checkInReminderOn: true,

      setWorkoutRemindersOn: (on) => set({ workoutRemindersOn: on }),
      setWeekdays: (weekdays) => set({ weekdays }),
      toggleWeekday: (weekday) =>
        set((s) => ({
          weekdays: s.weekdays.includes(weekday)
            ? s.weekdays.filter((d) => d !== weekday)
            : [...s.weekdays, weekday].sort((a, b) => a - b),
        })),
      setTime: (hour, minute) => set({ hour, minute }),
      setMorningNudgeOn: (on) => set({ morningNudgeOn: on }),
      setCheckInReminderOn: (on) => set({ checkInReminderOn: on }),
    }),
    {
      name: 'gym-tracker-reminders-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
