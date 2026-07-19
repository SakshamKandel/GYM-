import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { type Permission, type Targets, type Tier } from '@gym/shared';
import { mmkvStorage } from '../lib/mmkvStorage';
import {
  deleteRepoAccountData,
  setRepoAccount,
  startFreshAnonymousRepoContext,
  useStoredAnonymousRepoContext,
} from '../lib/repo';
import {
  ApiError,
  confirmGymTrackerServer,
  getProfileData,
  login,
  loginWithGoogle,
  logout as apiLogout,
  me,
  putProfileData,
  register,
  type AuthSession,
  type AuthUser,
} from '../lib/api/client';
import { signOutGoogle } from '../features/auth/components/NativeGoogleSignIn';
import { getMeStaff, type StaffIdentity, type StaffRole } from '../features/staff/api';
import { DEFAULT_PROFILE_FIELDS, DEFAULT_TARGETS, useProfile } from './profile';

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
  /**
   * The signed-in staff account's granted permission keys (empty for a plain
   * member and when signed out). Copied exactly from the server's effective
   * role-plus-override result; an empty list can be an intentional denial.
   * Persisted so console gating (features/staff/nav) resolves on first render,
   * before the refresh probe re-confirms the role.
   */
  staffPermissions: Permission[];

  /** Throws ApiError ('bad_credentials' | 'invalid' | 'network'). */
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Throws ApiError ('bad_credentials' | 'link_required' | 'not_configured' |
   * 'invalid' | 'network'). 'link_required' means the Google email already has
   * a password account — retry with that account's `password` to link Google
   * onto it, so both sign-in methods open the SAME account (and data).
   */
  signInWithGoogle: (idToken: string, password?: string) => Promise<void>;
  /** Throws ApiError ('email_taken' | 'invalid' | 'network'). */
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  /** Best-effort server logout; local state always clears. Never throws. */
  signOut: (options?: { purgeLocalAccountData?: boolean }) => Promise<void>;
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
 * Probe the account's staff identity — role AND the exact permission set the
 * server derived for it (contract §4.3). Best-effort: a non-staff account
 * resolves to `{ role: null, permissions: [] }`, and any failure (offline,
 * server hiccup) resolves to the same — the staff console simply stays hidden
 * rather than surfacing an error.
 */
async function fetchStaffIdentity(token: string): Promise<StaffIdentity> {
  try {
    return await getMeStaff(token);
  } catch {
    return { role: null, permissions: [] };
  }
}

/**
 * The server-derived list is authoritative. Never restore a role preset here:
 * doing so would silently undo explicit per-account denials.
 */
function resolvePermissions(identity: StaffIdentity): Permission[] {
  return [...identity.permissions];
}

/** Delay before the one-shot background staff-role retry after sign-in. */
const STAFF_ROLE_RETRY_MS = 5_000;

/**
 * One quiet background retry for the sign-in staff probe. fetchStaffRole
 * resolves null on ANY failure, so a transient blip at sign-in used to hide
 * the staff console until the next refresh() ("login did nothing" for staff).
 * Non-blocking and stale-token guarded; a second null just stays hidden.
 */
function retryStaffRoleOnce(token: string): void {
  setTimeout(() => {
    void (async () => {
      const state = useAuth.getState();
      // Signed out / switched accounts since, or the role already resolved
      // (e.g. an early refresh()) — nothing to retry.
      if (state.token !== token || state.staffRole !== null) return;
      const identity = await fetchStaffIdentity(token);
      if (identity.role === null) return;
      if (useAuth.getState().token !== token) return;
      useAuth.setState({
        staffRole: identity.role,
        staffPermissions: resolvePermissions(identity),
      });
    })();
  }, STAFF_ROLE_RETRY_MS);
}

/**
 * Adopt a fresh server user (e.g. the response of POST /api/subscription/tier)
 * through the SAME path refresh() uses, so anything reading useAuth's tier
 * (home tier ring, gates) re-renders immediately instead of waiting for the
 * next app foreground. Stale-token guarded like refresh(): a response that
 * raced a sign-out or account switch is dropped.
 */
export function applyServerUser(user: AuthUser, token: string): void {
  if (useAuth.getState().token !== token) return;
  setRepoAccount(user.id);
  useAuth.setState({ status: 'signedIn', user });
  adoptServerUser(user);
}

/**
 * Shared tail of every sign-in flow. Adopts the session, then restores the
 * cloud profile and probes the staff role CONCURRENTLY — they're independent
 * server calls, and running them serially doubled sign-in latency. Both are
 * still awaited: 'onboarded' must be restored and staffRole settled BEFORE
 * the caller's navigation gate (enterApp) runs.
 */
async function establishSession(
  session: AuthSession,
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  // Account switch OVER a live session (defect G1): signing in while another
  // account is still resident used to skip clearAccountState — so coach notes,
  // server-reviewed targets and the previous staffRole bled into the new
  // account, and the old server token was never revoked. Detect the token
  // change up front and wipe the previous account's out-of-store state +
  // revoke its token before adopting the new session. Nulling staffRole here
  // also prevents transiently pairing the OLD role with the NEW token until the
  // probe below resolves. (A fresh sign-in from signedOut has no prior token,
  // so this is a no-op then.)
  const previousToken = get().token;
  if (previousToken && previousToken !== session.token) {
    clearAccountState();
    // Best-effort, fire-and-forget revoke of the old token — the new session is
    // independent, so sign-in must never block (or fail) on this.
    void (async () => {
      try {
        await apiLogout(previousToken);
      } catch {
        // Offline / server hiccup — the old server session expires on its own.
      }
    })();
  }
  // Switch the local repository before publishing the new auth state. Any
  // screen that reacts to `signedIn` therefore reads only this account's rows.
  setRepoAccount(session.user.id);
  set({
    status: 'signedIn',
    token: session.token,
    user: session.user,
    staffRole: null,
    staffPermissions: [],
  });
  adoptServerUser(session.user);
  const [, identity] = await Promise.all([
    restoreOrBackupProfile(session.token, session.user.id),
    fetchStaffIdentity(session.token),
  ]);
  // Re-adopt after the restore: a fresh-account reset (or a stale blob) may
  // have wiped the tier/name adopted above; this is upgrade-only, so it's a
  // no-op otherwise.
  adoptServerUser(session.user);
  // The session changed while the calls were in flight (sign-out or account
  // switch) — a late result must not touch the new session's state.
  if (get().token !== session.token) return;
  set({ staffRole: identity.role, staffPermissions: resolvePermissions(identity) });
  if (identity.role === null) retryStaffRoleOnce(session.token);
}

/**
 * Accounts whose cloud-profile restore attempt RESOLVED this app run (found a
 * blob, found nothing, or backed the local profile up — any settled outcome).
 * Until an account is in here, the continuous backup (lib/profileSync) must
 * not CLAIM the device profile for it: a transient restore failure at sign-in
 * followed by an eager push would overwrite the account's cloud blob with
 * this device's local profile. refresh() retries the restore until it lands.
 */
const profileRestoreSettled = new Set<string>();

export function hasProfileRestoreSettled(accountId: string): boolean {
  return profileRestoreSettled.has(accountId);
}

/**
 * Cloud profile restore — the fix for "signed in but sent back to setup".
 * If the account has a saved profile, hydrate the local store from it
 * (onboarded included) so returning users land straight in the app.
 * If the server has nothing but this device finished onboarding, back the
 * local profile up instead. Best-effort: network failure keeps local state
 * (and leaves the account un-settled so refresh() retries).
 */
async function restoreOrBackupProfile(token: string, accountId: string): Promise<void> {
  try {
    const remote = await getProfileData(token);
    // The session changed while the fetch was in flight — a late blob must
    // not hydrate the new session's profile.
    if (useAuth.getState().token !== token) return;
    const local = useProfile.getState();
    if (remote && remote['onboarded'] === true) {
      // Server wins for setup/preferences; local tier keeps its upgrade rule.
      // Defaults-first spread: any key the blob doesn't carry resets to the
      // app default instead of keeping the previous account's value.
      const tier = local.tier;
      // Nested defaults-first for targets: a cloud blob saved before a Targets
      // field existed (e.g. `steps`) replaces the whole object in the spread
      // below, so new keys must be backfilled from DEFAULT_TARGETS explicitly.
      const remoteTargets = remote['targets'];
      const targets: Targets = {
        ...DEFAULT_TARGETS,
        ...(typeof remoteTargets === 'object' && !Array.isArray(remoteTargets)
          ? (remoteTargets as Partial<Targets>)
          : null),
      };
      useProfile.setState(
        (s) =>
          ({
            ...s,
            ...DEFAULT_PROFILE_FIELDS,
            ...remote,
            targets,
            syncAccountId: accountId,
          }) as typeof s,
      );
      if (TIER_RANK[tier] > TIER_RANK[useProfile.getState().tier]) {
        useProfile.getState().update({ tier });
      }
    } else if (local.syncAccountId !== null && local.syncAccountId !== accountId) {
      // No cloud profile for this account, and the device's profile belongs
      // to a DIFFERENT one — never upload it here. Start this account on a
      // clean slate instead (workout logs are separate and stay); claiming
      // the fingerprint is what re-enables cloud backup for it.
      useProfile.getState().resetForAccount(accountId);
    } else if (local.onboarded) {
      // Fingerprint is null (never synced) or already this account's — back
      // the local profile up to the cloud.
      const {
        update: _u,
        completeOnboarding: _c,
        resetAccountFields: _r,
        resetForAccount: _f,
        syncAccountId: _s,
        ...data
      } = local;
      await putProfileData(token, data as unknown as Record<string, unknown>);
      useProfile.getState().update({ syncAccountId: accountId });
    }
    // Every branch above is a settled outcome — the continuous backup may now
    // claim/push for this account.
    profileRestoreSettled.add(accountId);
  } catch {
    // Offline or server hiccup — the local profile stays authoritative and
    // the account stays un-settled; refresh() retries on the next foreground.
  }
}

/**
 * Wipe account-derived state OUTSIDE the auth store. Runs on both explicit
 * sign-out and the silent 401 sign-out so the next account never sees the
 * previous one's data — the profile keeps only device-local setup.
 */
function clearAccountState(): void {
  useProfile.getState().resetAccountFields();
  // Coach-reviewed targets + coach notes are account data — never let them
  // survive into the next sign-in on this device.
  // Lazy require (not a static import): progression/hooks imports back into
  // this module, and this only runs at sign-out — long after module init.
  const { clearServerSuggestions } =
    require('../features/progression/hooks') as typeof import('../features/progression/hooks');
  clearServerSuggestions();
}

async function leaveAccountRepository(
  accountId: string | null,
  purgeLocalAccountData: boolean,
): Promise<void> {
  // This changes the active owner synchronously before its durable metadata
  // write awaits, so signed-out renders cannot briefly see an older guest.
  try {
    await startFreshAnonymousRepoContext();
  } catch {
    // The new in-memory namespace remains active. A storage failure must never
    // make sign-out fail or reactivate the account that was just left.
  }
  if (purgeLocalAccountData && accountId !== null) {
    try {
      await deleteRepoAccountData(accountId);
    } catch {
      // The account namespace remains unreachable even if physical cleanup
      // fails; a later maintenance pass can safely retry the purge.
    }
  }
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'signedOut',
      token: null,
      user: null,
      staffRole: null,
      staffPermissions: [],

      signIn: async (email, password) => {
        const session = await login({ email: email.trim().toLowerCase(), password });
        // Awaited: 'onboarded' must be restored and staffRole settled BEFORE
        // the caller's navigation gate (enterApp) runs.
        await establishSession(session, set, get);
      },

      signInWithGoogle: async (idToken, password) => {
        const session = await loginWithGoogle(idToken, password);
        await establishSession(session, set, get);
      },

      signUp: async (email, password, displayName) => {
        const session = await register({
          email: email.trim().toLowerCase(),
          password,
          displayName: displayName.trim(),
        });
        await establishSession(session, set, get);
      },

      signOut: async (options) => {
        const token = get().token;
        const accountId = get().user?.id ?? null;
        const repoCleanup = leaveAccountRepository(
          accountId,
          options?.purgeLocalAccountData === true,
        );
        // Local state clears FIRST so sign-out is instant even offline; the
        // server-side cleanup below is best-effort in the background. (The
        // old order — await the network, then clear — could hang the UI on
        // "Signing out…" and lose the clear entirely if the app was killed.)
        clearAccountState();
        set({
          status: 'signedOut',
          token: null,
          user: null,
          staffRole: null,
          staffPermissions: [],
        });
        if (token) {
          // Fired before the Google await below so a hung native call can
          // never starve the server-side logout.
          void (async () => {
            // Lazy require (not a static import): lib/notifications imports
            // back into this module, so it must not be a top-level import.
            const { unregisterPushNotificationsAsync } =
              require('../lib/notifications') as typeof import('../lib/notifications');
            // Push unregister first — it needs the session the logout revokes.
            await unregisterPushNotificationsAsync(token);
            try {
              await apiLogout(token);
            } catch {
              // Offline sign-out is fine — the server session expires on its own.
            }
          })();
        }
        // Drop the native Google session so the next "Continue with Google"
        // asks which account instead of silently reusing the last one.
        await Promise.allSettled([signOutGoogle(), repoCleanup]);
      },

      refresh: async () => {
        const token = get().token;
        if (!token) return;
        const residentUser = get().user;
        if (residentUser !== null) setRepoAccount(residentUser.id);
        try {
          const user = await me(token);
          // The session changed while me() was in flight (sign-out or account
          // switch) — a late response must not resurrect the old session.
          if (get().token !== token) return;
          setRepoAccount(user.id);
          set({ status: 'signedIn', user });
          adoptServerUser(user);
          // Sign-in's restore attempt failed (offline blip)? Retry until one
          // settles — the continuous backup is claim-locked until then, so a
          // fresh device can't overwrite the account's cloud profile with an
          // empty local one after a single timeout.
          if (!profileRestoreSettled.has(user.id)) {
            void restoreOrBackupProfile(token, user.id);
          }
          // Re-probe staff identity so a mid-session grant/revoke (role AND the
          // server's permission set) is reflected. Probe directly (not via
          // fetchStaffIdentity, which collapses failures to a null identity): a
          // transient error must leave the persisted staffRole/permissions
          // untouched (offline-first) rather than hide the staff console. Only a
          // resolved probe — confirmed staff OR confirmed non-staff — overwrites.
          try {
            const identity = await getMeStaff(token);
            if (get().token !== token) return;
            set({ staffRole: identity.role, staffPermissions: resolvePermissions(identity) });
          } catch {
            // Transient probe failure — keep the persisted staffRole/permissions.
          }
        } catch (err) {
          // A stale failure must not touch the CURRENT session either — a
          // late 401 for the old token would otherwise wipe a fresh sign-in.
          if (get().token !== token) return;
          if (err instanceof ApiError && err.code === 'unauthorized') {
            // A 401 alone isn't proof of revocation: in dev BASE_URL is a LAN
            // host:port, and a foreign app squatting that port answers 401 to
            // everything — that once wiped valid sessions. Only honor the 401
            // when /api/health confirms we're talking to the real server.
            const confirmed = await confirmGymTrackerServer();
            if (get().token !== token) return;
            if (confirmed) {
              // Session expired or revoked server-side — quietly sign out and
              // clear account-derived state so no stale identity lingers.
              clearAccountState();
              const accountId = get().user?.id ?? null;
              const repoCleanup = leaveAccountRepository(accountId, false);
              set({
                status: 'signedOut',
                token: null,
                user: null,
                staffRole: null,
                staffPermissions: [],
              });
              void repoCleanup;
            }
          }
          // Network errors keep the signed-in state — the app is offline-first.
        }
      },
    }),
    {
      name: 'gym-tracker-auth-v1',
      storage: createJSONStorage(() => mmkvStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.status === 'signedIn' && state.token !== null && state.user !== null) {
          setRepoAccount(state.user.id);
        } else {
          useStoredAnonymousRepoContext();
        }
      },
    },
  ),
);
