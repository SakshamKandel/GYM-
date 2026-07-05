import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getAwardedBadges, toGamificationError, type AwardedBadge } from '../../lib/api/badges';
import { mmkvStorage } from '../../lib/mmkvStorage';
import { useAuth } from '../../state/auth';

/**
 * Badges store — the caller's own awarded badges, cached locally so the
 * Badges screen and the profile "N of 44 earned" header render instantly
 * (offline-first) and refresh from the server on hydrate.
 *
 * `newlyEarnedIds` is a transient (non-persisted) diff computed on every
 * successful hydrate: any badgeId present in the fresh server response but
 * absent from the previously-cached set. The Badges screen (or wherever
 * mounts BadgeCelebration) reads and then clears it, so the one-shot
 * celebration plays exactly once per newly-earned badge batch, even across
 * cold starts (the diff is against the *persisted* previous set, not memory).
 *
 * Fingerprinted to an account id like other per-account stores (checkin,
 * buddy) — an account switch on the same device resets the cache instead of
 * leaking one member's badges into another's UI.
 */

interface GamificationBadgesState {
  accountId: string | null;
  badges: AwardedBadge[];
  challengeTitles: Record<string, string>;
  /** Badge ids earned since the last hydrate the UI hasn't acknowledged yet. */
  newlyEarnedIds: string[];
  /**
   * True once this account has completed at least one hydrate with a
   * non-empty previous badge set to diff against — i.e. the FIRST hydrate
   * after adopting a fresh/switched account never treats its whole badge
   * history as "newly earned" (that would fire the celebration sheet for
   * every badge on a reinstall or second-device sign-in).
   */
  hasHydratedOnce: boolean;
  /** Reconcile with the server. Silent no-op offline/signed-out. Never throws. */
  hydrate: () => Promise<void>;
  /** Call after showing the celebration for the current newlyEarnedIds batch. */
  clearNewlyEarned: () => void;
}

export const useGamificationBadges = create<GamificationBadgesState>()(
  persist(
    (set, get) => ({
      accountId: null,
      badges: [],
      challengeTitles: {},
      newlyEarnedIds: [],
      hasHydratedOnce: false,

      hydrate: async () => {
        const auth = useAuth.getState();
        if (auth.status !== 'signedIn' || !auth.token || !auth.user) return;

        // Account switch on this device — reset before adopting fresh data so
        // a stale previous-account badge set never seeds the earned-diff.
        if (get().accountId !== auth.user.id) {
          set({
            accountId: auth.user.id,
            badges: [],
            challengeTitles: {},
            newlyEarnedIds: [],
            hasHydratedOnce: false,
          });
        }

        try {
          const result = await getAwardedBadges(auth.token);
          const { badges: prevBadges, hasHydratedOnce } = get();
          const prevIds = new Set(prevBadges.map((b) => b.badgeId));
          const freshIds = result.badges.map((b) => b.badgeId);
          // Only diff once this account has a real prior snapshot to diff
          // against — the very first hydrate after a fresh install / account
          // switch has nothing to compare (prevBadges is always []) and
          // would otherwise present the user's ENTIRE badge history as
          // newly-earned.
          const newlyEarned = hasHydratedOnce ? freshIds.filter((id) => !prevIds.has(id)) : [];

          set((state) => ({
            badges: result.badges,
            challengeTitles: result.challengeTitles,
            hasHydratedOnce: true,
            // Accumulate rather than overwrite: if the screen hasn't cleared
            // the previous batch yet, don't drop it mid-celebration.
            newlyEarnedIds: [...new Set([...state.newlyEarnedIds, ...newlyEarned])],
          }));
        } catch (err) {
          toGamificationError(err); // swallow — cached badges stand alone offline
        }
      },

      clearNewlyEarned: () => set({ newlyEarnedIds: [] }),
    }),
    {
      name: 'gym-tracker-gamification-badges-v1',
      storage: createJSONStorage(() => mmkvStorage),
      // newlyEarnedIds is a transient UI signal, not durable state.
      partialize: (s) => ({
        accountId: s.accountId,
        badges: s.badges,
        challengeTitles: s.challengeTitles,
        hasHydratedOnce: s.hasHydratedOnce,
      }),
    },
  ),
);
