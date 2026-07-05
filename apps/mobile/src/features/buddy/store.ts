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

  setData: (list: BuddyList, events: BuddyEvent[]) => void;
  setSessions: (sessions: BuddySession[]) => void;
  setReferrals: (referrals: Referral[]) => void;
  setTrials: (trials: Trial[], trialDays: number) => void;
  markNudged: (linkId: string, dateIso: string) => void;
  /** Wipe everything (sign-out) so the next account starts clean. */
  clear: () => void;
}

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

      setData: (list, events) => set({ list, events }),
      setSessions: (sessions) => set({ sessions }),
      setReferrals: (referrals) => set({ referrals }),
      setTrials: (trials, trialDays) => set({ trials, trialDays }),
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
