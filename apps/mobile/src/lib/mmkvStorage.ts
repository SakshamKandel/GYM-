import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV } from 'react-native-mmkv';
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
 */
const mmkv = Platform.OS !== 'web' ? createMMKV({ id: 'gym-tracker-store' }) : null;

export const mmkvStorage: StateStorage = mmkv
  ? {
      getItem: (name) => mmkv.getString(name) ?? null,
      setItem: (name, value) => mmkv.set(name, value),
      removeItem: (name) => {
        mmkv.remove(name);
      },
    }
  : {
      getItem: (name) => AsyncStorage.getItem(name),
      setItem: (name, value) => AsyncStorage.setItem(name, value),
      removeItem: (name) => AsyncStorage.removeItem(name),
    };
