import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '../lib/mmkvStorage';

/** Security preferences — currently the biometric app lock. */

interface SecurityState {
  /** Require fingerprint/face unlock when the app opens or returns. */
  biometricLock: boolean;
  setBiometricLock: (on: boolean) => void;
}

export const useSecurity = create<SecurityState>()(
  persist(
    (set) => ({
      biometricLock: false,
      setBiometricLock: (on) => set({ biometricLock: on }),
    }),
    {
      name: 'gym-tracker-security-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
