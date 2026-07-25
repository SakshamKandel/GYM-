import { Platform } from 'react-native';

/**
 * Where the store keys come from.
 *
 * RevenueCat issues ONE public key per platform (Project settings > API keys >
 * "Public app-specific keys"). They are safe to compile into the app — they can
 * only read offerings and start purchases the store itself confirms; nothing
 * about a tier is decided on this side of the wire.
 *
 * Missing key = store billing is simply not part of this build, and every
 * surface that would offer it stays hidden. Never a dead button.
 *
 * The reads must stay literal `process.env.EXPO_PUBLIC_…` member expressions:
 * that is how Expo inlines them at build time.
 */
export function storeApiKey(): string | null {
  const configured =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
      : Platform.OS === 'android'
        ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
        : undefined;
  const key = configured?.trim();
  return key ? key : null;
}

/** The store this device pays through, in the words members already know. */
export function storeName(): string {
  if (Platform.OS === 'ios') return 'the App Store';
  if (Platform.OS === 'android') return 'Google Play';
  return 'the app store';
}
