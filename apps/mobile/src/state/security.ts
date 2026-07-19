import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '../lib/mmkvStorage';

/** Security preferences — the biometric app lock, its PIN fallback, and the
 * re-lock grace timeout (Pack P). */

interface SecurityState {
  /** Require fingerprint/face unlock when the app opens or returns. */
  biometricLock: boolean;
  setBiometricLock: (on: boolean) => void;
  /**
   * SHA-256 digest of a PIN (see features/security/pin.ts) — a fallback app
   * lock for devices with no biometric hardware/enrollment, or a member who
   * simply prefers it. Never the raw PIN. null = no PIN set.
   */
  pinHash: string | null;
  setPinHash: (hash: string | null) => void;
  /**
   * Minutes of grace after backgrounding before the lock screen re-prompts
   * on return; 0 = always re-prompt (the pre-Pack-P default/behavior).
   * Content is still masked in the app-switcher snapshot regardless — this
   * only skips the RE-AUTHENTICATION step within the window.
   */
  lockTimeoutMinutes: number;
  setLockTimeoutMinutes: (minutes: number) => void;
}

export const useSecurity = create<SecurityState>()(
  persist(
    (set) => ({
      biometricLock: false,
      setBiometricLock: (on) => set({ biometricLock: on }),
      pinHash: null,
      setPinHash: (hash) => set({ pinHash: hash }),
      lockTimeoutMinutes: 0,
      setLockTimeoutMinutes: (minutes) => set({ lockTimeoutMinutes: minutes }),
    }),
    {
      name: 'gym-tracker-security-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);

/** True when either lock method is configured — the app should arm on cold start. */
export function isAppLockEnabled(state: Pick<SecurityState, 'biometricLock' | 'pinHash'>): boolean {
  return state.biometricLock || state.pinHash !== null;
}
