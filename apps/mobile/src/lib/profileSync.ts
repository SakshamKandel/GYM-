import { putProfileData } from './api/client';
import { useAuth } from '../state/auth';
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
  if (auth.status !== 'signedIn' || auth.token === null) return;
  const { update: _u, completeOnboarding: _c, ...data } = useProfile.getState();
  if (!data.onboarded) return; // nothing worth backing up yet
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
