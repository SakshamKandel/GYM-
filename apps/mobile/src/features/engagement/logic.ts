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
