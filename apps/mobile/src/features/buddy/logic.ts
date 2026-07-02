import type { BuddyErrorCode, BuddyEvent } from '../../lib/api/client';
import { addDays, toIsoDate } from '../../lib/dates';

/** Pure buddy logic — no React, no network. Screens stay thin. */

/** Hard product cap: buddy sync is intimate, not a feed. */
export const BUDDY_LIMIT = 5;

/** Monday of the week containing `iso` (app weeks run Mon–Sun). */
export function mondayOf(iso: string): string {
  const dow = (new Date(`${iso}T12:00:00`).getDay() + 6) % 7; // Mon = 0
  return addDays(iso, -dow);
}

/** The 7 ISO dates (Mon…Sun) of the week containing `todayIso`. */
export function weekDates(todayIso: string): string[] {
  const monday = mondayOf(todayIso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date of an event (payload.date wins over createdAt). */
export function eventDateIso(event: BuddyEvent): string {
  const d = event.payload?.date;
  if (d && ISO_DATE.test(d)) return d;
  const t = Date.parse(event.createdAt);
  return Number.isNaN(t) ? '' : toIsoDate(new Date(t));
}

function workoutsBy(events: BuddyEvent[], actorId: string): BuddyEvent[] {
  return events.filter((e) => e.type === 'workout_completed' && e.actor.id === actorId);
}

/** 7 booleans (Mon…Sun): did this buddy complete a workout that day? */
export function weekDots(events: BuddyEvent[], actorId: string, todayIso: string): boolean[] {
  const trained = new Set(workoutsBy(events, actorId).map(eventDateIso));
  return weekDates(todayIso).map((d) => trained.has(d));
}

/** ISO date of the buddy's most recent completed workout, or null. */
export function lastTrainedIso(events: BuddyEvent[], actorId: string): string | null {
  let latest: string | null = null;
  for (const e of workoutsBy(events, actorId)) {
    const d = eventDateIso(e);
    if (d && (latest === null || d > latest)) latest = d;
  }
  return latest;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T12:00:00`) - Date.parse(`${fromIso}T12:00:00`)) / 86_400_000,
  );
}

/** "today" · "yesterday" · "3 days ago" · "last week" · "5 weeks ago". */
export function relativeDayLabel(iso: string, todayIso: string): string {
  const days = daysBetween(iso, todayIso);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? 'last week' : `${weeks} weeks ago`;
}

/** Caption under a buddy's name. */
export function lastTrainedLabel(events: BuddyEvent[], actorId: string, todayIso: string): string {
  const iso = lastTrainedIso(events, actorId);
  return iso === null ? 'no sessions yet' : `last trained ${relativeDayLabel(iso, todayIso)}`;
}

/** Feed slice for the "This week" section — newest first. */
export function thisWeeksEvents(events: BuddyEvent[], todayIso: string): BuddyEvent[] {
  const monday = mondayOf(todayIso);
  return events
    .filter((e) => eventDateIso(e) >= monday)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 754 → "12:34" — mm:ss for the feed's duration stat. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 12480 → "12.5k" — compact volume numbers for the 3-stat row. */
export function formatCompact(v: number): string {
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(Math.round(v / 100) / 10).toFixed(1)}k`;
  return String(Math.round(v));
}

/** Avatar fallback: first letter of the display name (or a dot). */
export function avatarLetter(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : '·';
}

/** Friendly one-liners for invite failures — never raw server codes. */
export function inviteErrorLine(code: BuddyErrorCode): string {
  switch (code) {
    case 'not_found':
      return 'No account with that email yet — tell them to grab the app!';
    case 'invalid':
      return "That doesn't look like an email address.";
    case 'already_linked':
      return "You're already paired with them.";
    case 'buddy_limit':
      return 'Five buddies max — keep it tight.';
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    default:
      return "Can't reach the server — try again in a bit.";
  }
}

/** Friendly one-liner for join-session failures. */
export function joinSessionErrorLine(code: BuddyErrorCode): string {
  switch (code) {
    case 'tier_mismatch':
      return 'You need the same subscription plan to join this session.';
    case 'not_found':
      return 'This session has ended.';
    case 'forbidden':
      return 'Only accepted buddies can join live sessions.';
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    default:
      return "Can't join right now — try again in a bit.";
  }
}

/** Friendly one-liner for referral failures. */
export function referralErrorLine(code: BuddyErrorCode): string {
  switch (code) {
    case 'already_linked':
      return "You've already referred this email.";
    case 'invalid':
      return "That doesn't look like an email address.";
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    default:
      return "Can't send the referral — try again in a bit.";
  }
}

/** Friendly one-liner for trial failures. */
export function trialErrorLine(code: BuddyErrorCode): string {
  switch (code) {
    case 'trial_used':
      return "You've already used your trial for this plan.";
    case 'invalid':
      return 'Something went wrong — try again.';
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    default:
      return "Can't start the trial — try again in a bit.";
  }
}

/** Label for a referral status. */
export function referralStatusLabel(status: 'pending' | 'joined' | 'rewarded'): string {
  switch (status) {
    case 'pending':
      return 'Waiting for them to join';
    case 'joined':
      return 'Joined — discount unlocked!';
    case 'rewarded':
      return 'Reward claimed';
  }
}

/** Check if a trial is currently active. */
export function isTrialActive(trial: { active: boolean }): boolean {
  return trial.active;
}

/** Tiers available for trial (starter is free, no trial needed). */
export const TRIAL_TIERS = ['silver', 'gold', 'elite'] as const;
