import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV } from 'react-native-mmkv';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { StateStorage } from 'zustand/middleware';

/**
 * Zustand persist storage backed by MMKV. Synchronous reads mean persisted
 * state (auth session, profile, streaks, security prefs…) is available on
 * the very first render — no AsyncStorage-style async hydration flash where
 * the store briefly shows its defaults before rehydrating.
 *
 * MMKV has no web build, so web keeps using AsyncStorage (already backed by
 * localStorage there) behind the same StateStorage contract — callers never
 * need to know which one they got.
 *
 * Encryption (defect G7): MMKV stores the bearer token — including super_admin
 * staff sessions — and the account profile. Left unencrypted the file sits in
 * plaintext on disk, so we encrypt it with an AES-256 key kept in the OS secure
 * store (iOS Keychain / Android Keystore via expo-secure-store). The key is
 * minted once per install and read synchronously so MMKV's first-render
 * hydration is preserved. If secure storage is unavailable, native persistence
 * fails closed to process memory; bearer tokens are never written unencrypted.
 */

const STORE_ID = 'gym-tracker-store';

/** SecureStore slot holding the MMKV AES key (device keychain / keystore). */
const ENCRYPTION_KEY_SLOT = 'gym-tracker-mmkv-key';

/**
 * Fetch — or lazily mint — the MMKV encryption key from the OS secure store.
 * Synchronous SecureStore APIs (SDK 50+) keep the whole storage layer sync, so
 * first-render hydration is unaffected. If the keychain is unavailable we
 * return null and deliberately disable native disk persistence for this run.
 */
function loadEncryptionKey(): string | null {
  try {
    const existing = SecureStore.getItem(ENCRYPTION_KEY_SLOT);
    if (existing) return existing;
    // 16 random bytes → 32 hex chars (32 bytes), the AES-256 key-length ceiling.
    const bytes = getRandomBytes(16);
    let hex = '';
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
    SecureStore.setItem(ENCRYPTION_KEY_SLOT, hex);
    return hex;
  } catch {
    return null;
  }
}

/** Native encrypted MMKV, or null when secure persistence is unavailable. */
function createNativeStore(): ReturnType<typeof createMMKV> | null {
  const encryptionKey = loadEncryptionKey();
  if (!encryptionKey) return null;
  return createMMKV({
    id: STORE_ID,
    encryptionKey,
    encryptionType: 'AES-256',
    // A legacy plaintext file (an install predating encryption) or a corrupt
    // file can't be decrypted with the key — discard and start fresh (a forced
    // re-hydrate / re-sign-in) instead of crashing on launch.
    recoveryStrategy: 'discard-on-error',
  });
}

const mmkv = Platform.OS !== 'web' ? createNativeStore() : null;
const volatileNativeStorage = new Map<string, string>();

export const mmkvStorage: StateStorage = Platform.OS === 'web'
  ? {
      getItem: (name) => AsyncStorage.getItem(name),
      setItem: (name, value) => AsyncStorage.setItem(name, value),
      removeItem: (name) => AsyncStorage.removeItem(name),
    }
  : mmkv
  ? {
      getItem: (name) => mmkv.getString(name) ?? null,
      setItem: (name, value) => mmkv.set(name, value),
      removeItem: (name) => {
        mmkv.remove(name);
      },
    }
  : {
      getItem: (name) => volatileNativeStorage.get(name) ?? null,
      setItem: (name, value) => {
        volatileNativeStorage.set(name, value);
      },
      removeItem: (name) => {
        volatileNativeStorage.delete(name);
      },
    };
