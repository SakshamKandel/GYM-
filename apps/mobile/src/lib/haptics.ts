import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Haptic wrappers — every log action confirms physically (<100ms). No-ops on web. */

const isNative = Platform.OS !== 'web';

export function tapHaptic(): void {
  if (isNative) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function logHaptic(): void {
  if (isNative) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function successHaptic(): void {
  if (isNative) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** Heavy burst for PRs. */
export function prHaptic(): void {
  if (!isNative) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 120);
}

export function warnHaptic(): void {
  if (isNative) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}
