import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  BuddyEvent,
  BuddyList,
  BuddySession,
  Referral,
  Trial,
} from '../../lib/api/client';
import { mmkvStorage } from '../../lib/mmkvStorage';
import type { UnreadSummary } from './chatApi';

/**
 * Buddy cache — the last successful server snapshot plus the per-day nudge
 * ledger, persisted so the tab renders instantly (and survives offline
 * launches). Network refreshes overwrite it; failures leave it untouched.
 */

interface BuddyStore {
  /** Last known link lists; null until the first successful fetch. */
  list: BuddyList | null;
  /** Last known feed events. */
  events: BuddyEvent[];
  /** linkId → local ISO date the user last nudged that buddy. */
  nudgedByLink: Record<string, string>;
  /** Active live sessions from buddies. */
  sessions: BuddySession[];
  /** This user's referrals. */
  referrals: Referral[];
  /** Trial status for this account. */
  trials: Trial[];
  /** Number of trial days (server-configured, typically 2). */
  trialDays: number;
  /** linkId → unread buddy-DM count, from GET /api/me/unread's sparse list
   * (missing linkId = 0 unread). Also carries the support/coach_chat counts
   * so pushRefresh can drive a single shared fetch — the Buddy tab itself
   * only ever reads `unreadByLink`. */
  unread: UnreadSummary;

  setData: (list: BuddyList, events: BuddyEvent[]) => void;
  setSessions: (sessions: BuddySession[]) => void;
  setReferrals: (referrals: Referral[]) => void;
  setTrials: (trials: Trial[], trialDays: number) => void;
  setUnread: (unread: UnreadSummary) => void;
  markNudged: (linkId: string, dateIso: string) => void;
  /** Wipe everything (sign-out) so the next account starts clean. */
  clear: () => void;
}

const EMPTY_UNREAD: UnreadSummary = { support: 0, coachChat: 0, buddy: [] };

export const useBuddyStore = create<BuddyStore>()(
  persist(
    (set) => ({
      list: null,
      events: [],
      nudgedByLink: {},
      sessions: [],
      referrals: [],
      trials: [],
      trialDays: 2,
      unread: EMPTY_UNREAD,

      setData: (list, events) => set({ list, events }),
      setSessions: (sessions) => set({ sessions }),
      setReferrals: (referrals) => set({ referrals }),
      setTrials: (trials, trialDays) => set({ trials, trialDays }),
      setUnread: (unread) => set({ unread }),
      markNudged: (linkId, dateIso) =>
        set((s) => ({ nudgedByLink: { ...s.nudgedByLink, [linkId]: dateIso } })),
      clear: () =>
        set({
          list: null,
          events: [],
          nudgedByLink: {},
          sessions: [],
          referrals: [],
          trials: [],
          trialDays: 2,
          unread: EMPTY_UNREAD,
        }),
    }),
    {
      name: 'gym-tracker-buddy-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);

/** Has this link been nudged today already? */
export function nudgedToday(nudgedByLink: Record<string, string>, linkId: string, todayIso: string): boolean {
  return nudgedByLink[linkId] === todayIso;
}

/** Unread buddy-DM count for one link (0 when the link carries no unread row). */
export function unreadForLink(unread: UnreadSummary, linkId: string): number {
  return unread.buddy.find((b) => b.linkId === linkId)?.count ?? 0;
}

/** True when ANY accepted buddy has an unread DM — drives the tab-level dot. */
export function hasAnyBuddyUnread(unread: UnreadSummary): boolean {
  return unread.buddy.some((b) => b.count > 0);
}
