import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '../lib/mmkvStorage';

/**
 * Gamification display prefs — tiny persisted slice.
 *
 * `hideGamification` is the adult-trust "Hide gamification" settings toggle
 * (gamification design law 7): when on, XP/level/rank/badge UI hides across
 * the app (profile ring, badges screen entry, streak shield line stays —
 * the streak itself is core training feedback, not a game layer).
 *
 * `publicBoardHidden` is the local mirror of the server-side public-
 * leaderboard opt-out flag (accounts.publicBoardHidden). The server is the
 * source of truth — the settings toggle flips this optimistically, and both
 * the settings screen (on focus) and the leaderboard screen reconcile it
 * from GET /api/leaderboard/public's `me.hidden`. Default false = shown on
 * the board.
 *
 * The mirror is ACCOUNT-SCOPED via `publicBoardAccountId`: this slice is a
 * device-global persisted store that survives sign-out/account switches
 * (clearAccountState() doesn't touch it — `hideGamification` is a device
 * preference that must survive), so a bare boolean could leak account A's
 * opt-out into account B's settings toggle and lie about B's actual server-
 * side visibility. Readers must treat the value as valid ONLY when the
 * stamp matches the signed-in account (see publicBoardHiddenFor) and fall
 * back to the default otherwise.
 */

export interface CachedProfileSnapshot {
  xpTotal: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  rank: 'bronze' | 'silver' | 'gold' | 'elite';
}

export interface GamificationDisplayState {
  hideGamification: boolean;
  /** Account the publicBoardHidden mirror belongs to — never read the flag without checking this. */
  publicBoardAccountId: string | null;
  publicBoardHidden: boolean;
  /** Account the cached XP/rank snapshot belongs to — same scoping rule as publicBoardAccountId. */
  profileAccountId: string | null;
  /** Last server-confirmed XP/level/rank, so the rank emblem renders instantly on focus instead of flashing while GET /api/gamification is in flight. */
  profileSnapshot: CachedProfileSnapshot | null;
  setHideGamification: (hide: boolean) => void;
  setPublicBoardHidden: (accountId: string, hidden: boolean) => void;
  setProfileSnapshot: (accountId: string, snapshot: CachedProfileSnapshot) => void;
}

/** The cached XP/rank snapshot for a specific account, or null when the cache belongs to another account. */
export function profileSnapshotFor(
  state: Pick<GamificationDisplayState, 'profileAccountId' | 'profileSnapshot'>,
  accountId: string | null | undefined,
): CachedProfileSnapshot | null {
  return accountId !== null && accountId !== undefined && state.profileAccountId === accountId
    ? state.profileSnapshot
    : null;
}

/**
 * The public-board opt-out mirror for a specific account. Falls back to the
 * default (false = shown) when the persisted mirror belongs to a different
 * account (or to none) — the server flag still governs actual visibility,
 * and the settings/leaderboard screens reconcile the mirror from it.
 */
export function publicBoardHiddenFor(
  state: Pick<GamificationDisplayState, 'publicBoardAccountId' | 'publicBoardHidden'>,
  accountId: string | null | undefined,
): boolean {
  return accountId !== null && accountId !== undefined && state.publicBoardAccountId === accountId
    ? state.publicBoardHidden
    : false;
}

export const useGamificationDisplay = create<GamificationDisplayState>()(
  persist(
    (set) => ({
      hideGamification: false,
      publicBoardAccountId: null,
      publicBoardHidden: false,
      profileAccountId: null,
      profileSnapshot: null,
      setHideGamification: (hideGamification) => set({ hideGamification }),
      setPublicBoardHidden: (publicBoardAccountId, publicBoardHidden) =>
        set({ publicBoardAccountId, publicBoardHidden }),
      setProfileSnapshot: (profileAccountId, profileSnapshot) =>
        set({ profileAccountId, profileSnapshot }),
    }),
    {
      name: 'gym-tracker-gamification-display-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
