import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Rest-timer alert — the one job a rest timer has when the phone goes back in
 * a pocket: tell you the rest is over.
 *
 * The in-app timer only ticks while JavaScript runs, so a backgrounded phone
 * gets no countdown, no haptic, nothing. This schedules ONE local notification
 * for the moment the rest ends, so the member hears it wherever they are.
 *
 * Rules:
 *  - It only ever fires when the app is NOT in the foreground. Foreground rest
 *    already has the countdown + the end-of-rest haptic, so a banner would just
 *    be noise; arming while foregrounded records the end time and waits for the
 *    app to actually leave (and returning to the foreground cancels it again).
 *  - CHECK-ONLY permission (`getPermissionsAsync`) — this fires from logging a
 *    set, not from an ask surface, so it must never raise an OS dialog.
 *  - Never throws into the UI: every call is wrapped, and logging a set must
 *    never block on it (callers fire-and-forget).
 *  - One stable identifier, so re-arming replaces rather than stacks.
 */

/** Stable id — scheduling with this again replaces the pending alert. */
const REST_ALERT_ID = 'rest-timer-end';
/** The app-wide channel created by setupNotifications() (importance MAX). */
const ALERT_CHANNEL_ID = 'default';

/** Only iOS/Android schedule local notifications here. */
function isSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** Epoch ms the armed rest ends at; null when nothing is armed. */
let pendingEndsAt: number | null = null;
let appStateSub: { remove: () => void } | null = null;

/** Drop any pending OS request. Safe to call when nothing is scheduled. */
async function cancelScheduled(): Promise<void> {
  if (!isSupported()) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REST_ALERT_ID);
  } catch {
    // Nothing scheduled, or the module is unavailable.
  }
}

/** Schedule the alert for `endsAt`, replacing any previous request. */
async function scheduleFor(endsAt: number): Promise<void> {
  if (!isSupported()) return;
  const seconds = Math.round((endsAt - Date.now()) / 1000);
  if (seconds < 1) return;
  try {
    const granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) return;
    // The rest may have been skipped/adjusted while permission resolved.
    if (pendingEndsAt !== endsAt) return;
    await Notifications.scheduleNotificationAsync({
      identifier: REST_ALERT_ID,
      content: { title: 'Rest over', body: 'Next set is up.' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, seconds),
        repeats: false,
        channelId: ALERT_CHANNEL_ID,
      },
    });
  } catch {
    // Denied, unsupported, or the module is unavailable — stay silent.
  }
}

/**
 * Install the foreground/background watcher once. Leaving the app arms the
 * alert for whatever rest is still running; coming back cancels it, because
 * the on-screen timer takes over from there.
 */
function ensureAppStateWatcher(): void {
  if (appStateSub || !isSupported()) return;
  appStateSub = AppState.addEventListener('change', (next) => {
    const endsAt = pendingEndsAt;
    if (endsAt === null) return;
    if (next === 'active') void cancelScheduled();
    else void scheduleFor(endsAt);
  });
}

/**
 * Arm (or re-arm) the alert for a rest ending at `endsAt` (epoch ms). Call on
 * every start/adjust — the newest end time always wins.
 */
export function armRestAlert(endsAt: number): void {
  if (!isSupported()) return;
  pendingEndsAt = endsAt;
  ensureAppStateWatcher();
  // Already backgrounded (logged a set, screen locked) — schedule right away.
  // Foreground arming waits for the app to leave, so the banner never
  // duplicates the countdown the member is looking at.
  if (AppState.currentState !== 'active') void scheduleFor(endsAt);
  else void cancelScheduled();
}

/** Disarm: the rest was skipped, finished, or the workout ended. */
export function disarmRestAlert(): void {
  if (!isSupported()) return;
  const endsAt = pendingEndsAt;
  pendingEndsAt = null;
  // The countdown reaching zero also disarms (the store clears `rest`), and on
  // Android that tick can still be running in the background — cancelling
  // within a whisker of the delivery time would race the alert away at the one
  // moment it is supposed to sound. A rest that has reached its end keeps it.
  if (endsAt !== null && Date.now() >= endsAt - 1000) return;
  void cancelScheduled();
}
