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
import { getMeStaff, type StaffRole } from '../features/staff/api';
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
  /**
   * The signed-in account's staff role, or null for a plain member (and always
   * null when signed out). Populated after sign-in and on refresh() by probing
   * GET /api/me/staff; a failed probe leaves it null so the staff console just
   * stays hidden. Persisted so a returning staff member sees their console
   * immediately, before the refresh probe completes.
   */
  staffRole: StaffRole | null;

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
 * Probe the account's staff role. Best-effort: a non-staff account resolves to
 * null, and any failure (offline, server hiccup) resolves to null too — the
 * staff console simply stays hidden rather than surfacing an error.
 */
async function fetchStaffRole(token: string): Promise<StaffRole | null> {
  try {
    return await getMeStaff(token);
  } catch {
    return null;
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
      staffRole: null,

      signIn: async (email, password) => {
        const session = await login({ email: email.trim().toLowerCase(), password });
        set({ status: 'signedIn', token: session.token, user: session.user });
        adoptServerUser(session.user);
        // Awaited: 'onboarded' must be restored BEFORE navigation gates run.
        await restoreOrBackupProfile(session.token);
        // Awaited too: AuthScreen reads staffRole right after this resolves to
        // decide between the staff console and the onboarding-gated root.
        set({ staffRole: await fetchStaffRole(session.token) });
      },

      signInWithGoogle: async (idToken) => {
        const session = await loginWithGoogle(idToken);
        set({ status: 'signedIn', token: session.token, user: session.user });
        adoptServerUser(session.user);
        await restoreOrBackupProfile(session.token);
        set({ staffRole: await fetchStaffRole(session.token) });
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
        set({ staffRole: await fetchStaffRole(session.token) });
      },

      signOut: async () => {
        const token = get().token;
        try {
          if (token) await apiLogout(token);
        } catch {
          // Offline sign-out is fine — the server session expires on its own.
        }
        set({ status: 'signedOut', token: null, user: null, staffRole: null });
      },

      refresh: async () => {
        const token = get().token;
        if (!token) return;
        try {
          const user = await me(token);
          set({ status: 'signedIn', user });
          adoptServerUser(user);
          // Re-probe staff role so a mid-session grant/revoke is reflected. A
          // failed probe leaves the persisted value untouched (offline-first).
          const role = await fetchStaffRole(token);
          set({ staffRole: role });
        } catch (err) {
          if (err instanceof ApiError && err.code === 'unauthorized') {
            // Session expired or revoked server-side — quietly sign out.
            set({ status: 'signedOut', token: null, user: null, staffRole: null });
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
