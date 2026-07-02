import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Tier } from '@gym/shared';
import {
  ApiError,
  getProfileData,
  login,
  loginWithGoogle,
  logout as apiLogout,
  me,
  putProfileData,
  register,
  type AuthUser,
} from '../lib/api/client';
import { useProfile } from './profile';

/**
 * Optional account on top of the local-first app. Signing in exists for
 * cloud sync / subscriptions — everything keeps working signed out, and
 * network failures NEVER lock the user out of their local data.
 */

// @gym/shared doesn't export a tier order — keep in sync with logic/entitlements.ts.
const TIER_RANK: Record<Tier, number> = { starter: 0, silver: 1, gold: 2, elite: 3 };

export interface AuthState {
  status: 'signedOut' | 'signedIn';
  token: string | null;
  user: AuthUser | null;

  /** Throws ApiError ('bad_credentials' | 'invalid' | 'network'). */
  signIn: (email: string, password: string) => Promise<void>;
  /** Throws ApiError ('bad_credentials' | 'not_configured' | 'invalid' | 'network'). */
  signInWithGoogle: (idToken: string) => Promise<void>;
  /** Throws ApiError ('email_taken' | 'invalid' | 'network'). */
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  /** Best-effort server logout; local state always clears. Never throws. */
  signOut: () => Promise<void>;
  /** Re-validate the session (call on focus). Silently signs out on 401. */
  refresh: () => Promise<void>;
}

/** Server tier only ever upgrades the local profile — never downgrades offline access. */
function adoptServerUser(user: AuthUser): void {
  const profile = useProfile.getState();
  if (TIER_RANK[user.tier] > TIER_RANK[profile.tier]) {
    profile.update({ tier: user.tier });
  }
  if (!profile.displayName.trim() && user.displayName.trim()) {
    profile.update({ displayName: user.displayName.trim() });
  }
}

/**
 * Cloud profile restore — the fix for "signed in but sent back to setup".
 * If the account has a saved profile, hydrate the local store from it
 * (onboarded included) so returning users land straight in the app.
 * If the server has nothing but this device finished onboarding, back the
 * local profile up instead. Best-effort: network failure keeps local state.
 */
async function restoreOrBackupProfile(token: string): Promise<void> {
  try {
    const remote = await getProfileData(token);
    const local = useProfile.getState();
    if (remote && remote['onboarded'] === true) {
      // Server wins for setup/preferences; local tier keeps its upgrade rule.
      const tier = local.tier;
      useProfile.setState((s) => ({ ...s, ...remote }) as typeof s);
      if (TIER_RANK[tier] > TIER_RANK[useProfile.getState().tier]) {
        useProfile.getState().update({ tier });
      }
    } else if (local.onboarded) {
      const { update: _u, completeOnboarding: _c, ...data } = local;
      await putProfileData(token, data as unknown as Record<string, unknown>);
    }
  } catch {
    // Offline or server hiccup — the local profile stays authoritative.
  }
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'signedOut',
      token: null,
      user: null,

      signIn: async (email, password) => {
        const session = await login({ email: email.trim().toLowerCase(), password });
        set({ status: 'signedIn', token: session.token, user: session.user });
        adoptServerUser(session.user);
        // Awaited: 'onboarded' must be restored BEFORE navigation gates run.
        await restoreOrBackupProfile(session.token);
      },

      signInWithGoogle: async (idToken) => {
        const session = await loginWithGoogle(idToken);
        set({ status: 'signedIn', token: session.token, user: session.user });
        adoptServerUser(session.user);
        await restoreOrBackupProfile(session.token);
      },

      signUp: async (email, password, displayName) => {
        const session = await register({
          email: email.trim().toLowerCase(),
          password,
          displayName: displayName.trim(),
        });
        set({ status: 'signedIn', token: session.token, user: session.user });
        adoptServerUser(session.user);
        await restoreOrBackupProfile(session.token);
      },

      signOut: async () => {
        const token = get().token;
        try {
          if (token) await apiLogout(token);
        } catch {
          // Offline sign-out is fine — the server session expires on its own.
        }
        set({ status: 'signedOut', token: null, user: null });
      },

      refresh: async () => {
        const token = get().token;
        if (!token) return;
        try {
          const user = await me(token);
          set({ status: 'signedIn', user });
          adoptServerUser(user);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'unauthorized') {
            // Session expired or revoked server-side — quietly sign out.
            set({ status: 'signedOut', token: null, user: null });
          }
          // Network errors keep the signed-in state — the app is offline-first.
        }
      },
    }),
    {
      name: 'gym-tracker-auth-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
