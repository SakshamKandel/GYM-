import type { Href } from 'expo-router';
import type { PrRecord, SetLog, WorkoutLog } from '@gym/shared';
import { addDays } from '../../lib/dates';

/** Pure helpers for the home dashboard + streak display. */

/**
 * Cast a route string to a typed Href. Some routes we push to are owned by
 * concurrently-built features (settings, workout) so the generated
 * typed-routes file may not know them yet.
 */
export function toHref(path: string): Href {
  return path as Href;
}

/** "Good morning," style greeting caption by local hour (0–23). */
export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning,';
  if (hour < 18) return 'Good afternoon,';
  return 'Good evening,';
}

/** Single uppercase letter for the avatar circle. */
export function avatarLetter(displayName: string): string {
  return (displayName.trim().charAt(0) || 'A').toUpperCase();
}

/** 12540 → "12.5K", 8450 → "8450". Big-tile friendly numbers. */
export function formatCompact(n: number): string {
  if (n >= 10_000) {
    const k = Math.round(n / 100) / 10;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return String(Math.round(n));
}

/** ISO date of the Monday of the week containing `iso`. */
export function weekStartIso(iso: string): string {
  const dow = new Date(`${iso}T12:00:00`).getDay(); // 0 Sun .. 6 Sat
  return addDays(iso, -((dow + 6) % 7));
}

/** PRs on/after `sinceIso`. */
export function prCountSince(records: PrRecord[], sinceIso: string): number {
  return records.filter((r) => r.date >= sinceIso).length;
}

/** Completed workouts only (active/abandoned sessions don't count). */
export function countFinished(workouts: WorkoutLog[]): number {
  return workouts.filter((w) => w.finishedAt !== null).length;
}

/** Total volume (kg × reps) across a workout's sets. */
export function volumeOfSets(sets: SetLog[]): number {
  return Math.round(sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0));
}

/** Goal for the first-workouts activation quest: three finished workouts. */
export const QUEST_GOAL = 3 as const;
/** Activation window length in days from the quest start. */
export const QUEST_WINDOW_DAYS = 14;

export interface QuestProgress {
  /** Finished workouts so far, capped at the goal. */
  done: number;
  goal: typeof QUEST_GOAL;
  /** Whole days left in the 14-day window (0 on/after the last day). */
  daysLeft: number;
  /** Reached the goal. */
  complete: boolean;
  /** Window elapsed without completing — card should disappear. */
  expired: boolean;
}

/**
 * Pure progress for the first-3-workouts quest. `finishedCount` is the number
 * of finished workouts since `startIso`; the window is 14 days from `startIso`.
 * `expired` only when the window has run out AND the goal wasn't met.
 */
export function questProgress(
  finishedCount: number,
  startIso: string,
  todayIsoStr: string,
): QuestProgress {
  const done = Math.min(Math.max(finishedCount, 0), QUEST_GOAL);
  const complete = done >= QUEST_GOAL;
  const endIso = addDays(startIso, QUEST_WINDOW_DAYS);
  // Whole days remaining, clamped to the window; last day still shows 1.
  const daysLeft = Math.max(0, daysBetween(todayIsoStr, endIso));
  const expired = !complete && todayIsoStr >= endIso;
  return { done, goal: QUEST_GOAL, daysLeft, complete, expired };
}

/** Whole calendar days from `fromIso` to `toIso` (negative if `toIso` is past). */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T12:00:00`).getTime();
  const to = new Date(`${toIso}T12:00:00`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}
