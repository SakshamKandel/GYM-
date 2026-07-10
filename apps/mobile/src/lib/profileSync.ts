import { putProfileData } from './api/client';
import { hasProfileRestoreSettled, useAuth } from '../state/auth';
import { useProfile } from '../state/profile';

/**
 * Continuous profile backup: any profile change while signed in is pushed
 * to the cloud (debounced) so setup, targets and preferences survive
 * reinstalls and follow the account to new devices. Fire-and-forget —
 * offline changes simply sync on the next successful push or sign-in.
 */

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function push(): void {
  const auth = useAuth.getState();
  if (auth.status !== 'signedIn' || auth.token === null || auth.user === null) return;
  const profile = useProfile.getState();
  if (!profile.onboarded) return; // nothing worth backing up yet
  // Cross-account guard: a profile fingerprinted to another account must
  // never be uploaded into this one (mirrors restoreOrBackupProfile).
  if (profile.syncAccountId !== null && profile.syncAccountId !== auth.user.id) return;
  if (profile.syncAccountId === null) {
    // Claim-lock: never claim an unclaimed device profile until the account's
    // cloud restore attempt has settled. A restore that merely timed out at
    // sign-in must not be followed by a push that overwrites the account's
    // real cloud blob with this device's local state (auth retries the
    // restore on refresh; the claim happens on the next push after it lands).
    if (!hasProfileRestoreSettled(auth.user.id)) return;
    // First backup for this account — claim the local profile for it.
    profile.update({ syncAccountId: auth.user.id });
  }
  const {
    update: _u,
    completeOnboarding: _c,
    resetAccountFields: _r,
    resetForAccount: _f,
    syncAccountId: _s,
    ...data
  } = useProfile.getState();
  void putProfileData(auth.token, data as unknown as Record<string, unknown>).catch(() => {
    // Offline — the next change or sign-in retries.
  });
}

export function startProfileSync(): void {
  if (started) return;
  started = true;
  useProfile.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, 3000);
  });
  // Push once shortly after start so the CURRENT profile (incl. the selected
  // tier) syncs to the server even if nothing changes this session — this is
  // what makes server-gated Elite features unlock without re-toggling.
  setTimeout(push, 1500);
}

/**
 * Force an immediate profile backup (e.g. right after choosing a plan) so the
 * server tier updates without waiting for the debounce. Fire-and-forget.
 */
export function syncProfileNow(): void {
  push();
}
