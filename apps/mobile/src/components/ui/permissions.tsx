import { Linking, Platform, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { Button } from './Button';

/**
 * Shared OS-permission helpers.
 *
 * Every camera / photo-library / notification ask in the app used to stop at
 * "allow it in Settings" without saying whether the OS would ever ask again,
 * and without a way to get there. These helpers give every call site the same
 * two facts — `granted` and `blocked` (the OS will NOT ask again; only the
 * system Settings app can change it) — plus one consistent route out.
 *
 * Lives in components/ui rather than a feature module on purpose: feature
 * modules may not import each other (CLAUDE.md rule 2), and several features
 * plus several screens need exactly this.
 *
 * Deliberately NOT re-exported from components/ui/index.ts — importing it
 * would pull expo-image-picker and expo-notifications into every screen that
 * only wanted a Button. Import it directly:
 *   import { requestMediaPermission } from '../components/ui/permissions';
 */

/** Which media permission a call site needs. */
export type MediaPermissionKind = 'camera' | 'library';

export interface MediaPermissionResult {
  /** The picker/camera may be opened. */
  granted: boolean;
  /**
   * Permanently denied — the OS will no longer show its prompt, so the only
   * way back is the system Settings app. Never true when `granted` is true.
   */
  blocked: boolean;
}

/**
 * Request a camera or photo-library permission and report BOTH outcomes the
 * UI cares about. Never throws: a module failure reads as a plain (askable)
 * denial so the caller still shows its normal "we need access" line.
 */
export async function requestMediaPermission(
  kind: MediaPermissionKind,
): Promise<MediaPermissionResult> {
  try {
    const response =
      kind === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    // `granted` stays the single source of truth for "can we open it" — on
    // iOS a LIMITED library selection is granted, and the picker works.
    return { granted: response.granted, blocked: !response.granted && !response.canAskAgain };
  } catch {
    return { granted: false, blocked: false };
  }
}

/**
 * Plain-language denial line. `purpose` completes "…to <purpose>" — write it
 * as a member-facing verb phrase, e.g. 'take a progress photo'.
 */
export function mediaPermissionMessage(
  kind: MediaPermissionKind,
  purpose: string,
  blocked: boolean,
): string {
  const source = kind === 'camera' ? 'Camera access' : 'Photo library access';
  return blocked
    ? `${source} is switched off in your phone settings. Turn it on to ${purpose}.`
    : `${source} is needed to ${purpose}. Try again and choose Allow.`;
}

/**
 * Notification permission as the reminder UI needs to read it — PASSIVE, so
 * it never triggers an OS prompt of its own (call it only to explain a
 * failure that already happened).
 *
 * - 'granted'     — allowed to post notifications.
 * - 'denied'      — refused, but the OS will still show its prompt again.
 * - 'blocked'     — refused for good; only phone settings can turn it back on.
 * - 'unsupported' — web, or the notifications module is unavailable.
 */
export type NotificationPermissionState = 'granted' | 'denied' | 'blocked' | 'unsupported';

export async function notificationPermissionState(): Promise<NotificationPermissionState> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
  try {
    const response = await Notifications.getPermissionsAsync();
    if (response.granted) return 'granted';
    return response.canAskAgain ? 'denied' : 'blocked';
  } catch {
    return 'unsupported';
  }
}

/**
 * Open this app's page in the system Settings app. Best-effort — a phone with
 * no settings intent just does nothing rather than crashing the screen.
 */
export function openAppSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

const styles = StyleSheet.create({
  // Hug the label instead of spanning the row: this is a recovery affordance
  // sitting under an error line, never a screen's primary CTA.
  button: { alignSelf: 'flex-start' },
});

/**
 * The one route out of a permanently-denied permission. Pair it with a line
 * that says WHAT is switched off and why the screen needs it.
 */
export function OpenSettingsButton({ label = 'Open Settings' }: { label?: string }) {
  return (
    <Button label={label} variant="secondary" onPress={openAppSettings} style={styles.button} />
  );
}
