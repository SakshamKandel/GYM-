import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { colors } from '@gym/ui-tokens';
import { registerPushToken, unregisterPushToken } from './api/client';
import { useAuth } from '../state/auth';

/**
 * Thin, crash-safe wrapper around expo-notifications for:
 *  - the first-3-workouts activation nudge (ONE local notification),
 *  - the app-wide notification foundation (foreground handler + Android
 *    'default' channel that the push server targets),
 *  - Expo push-token registration for buddy pushes, and
 *  - the local, recurring reminder set (workout schedule / morning nudge /
 *    weekly check-in) surfaced in Settings.
 *
 * Rules honoured here:
 *  - No-op on web (expo-notifications scheduling is native-only here).
 *  - Never throws into the UI — every call is wrapped in try/catch.
 *  - Opt-in: we only ask for permission at the moment we schedule/register.
 */

/** Stable id so the reminder can always be found and cancelled. */
const FIRST_WORKOUTS_REMINDER_ID = 'first-workouts-reminder';

/** Stable ids for the recurring reminder set (cancel-then-reschedule). */
const WORKOUT_REMINDER_PREFIX = 'workout-rem-';
const MORNING_NUDGE_ID = 'morning-nudge';
const CHECK_IN_REMINDER_ID = 'checkin-reminder';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** True only where scheduling actually works (iOS/Android). */
function isSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Ask for notification permission (opt-in). Resolves to whether we're allowed
 * to post notifications. Safe to call repeatedly; never throws.
 */
export async function requestPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

/**
 * Schedule the single "get your next workout in" reminder `daysFromNow` out.
 * Cancels any existing one first (so this is idempotent), requests permission,
 * then schedules with a stable identifier. Returns true if a notification was
 * actually scheduled.
 */
export async function scheduleFirstWorkoutsReminder(
  daysFromNow: number,
  title: string,
  body: string,
): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    const granted = await requestPermission();
    if (!granted) return false;

    // Idempotent: drop any prior copy before re-scheduling.
    await Notifications.cancelScheduledNotificationAsync(FIRST_WORKOUTS_REMINDER_ID);

    const seconds = Math.max(1, Math.round(daysFromNow * SECONDS_PER_DAY));
    await Notifications.scheduleNotificationAsync({
      identifier: FIRST_WORKOUTS_REMINDER_ID,
      content: { title, body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Cancel the reminder (e.g. once the quest is complete). Never throws. */
export async function cancelFirstWorkoutsReminder(): Promise<void> {
  if (!isSupported()) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(FIRST_WORKOUTS_REMINDER_ID);
  } catch {
    // no-op — nothing to cancel or module unavailable.
  }
}

// ════════════════════════════════════════════════════════════════
// Notification foundation — call once at app start.
// ════════════════════════════════════════════════════════════════

/**
 * Wire up the app-wide notification behaviour: show banners/list + play sound
 * even while the app is foregrounded, and create the Android 'default' channel
 * (importance MAX, red accent light) that the push server sends buddy pushes
 * to. Idempotent and crash-safe — safe to call once on mount.
 */
export async function setupNotifications(): Promise<void> {
  if (!isSupported()) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Handler couldn't be set (module unavailable) — nothing else to do.
  }

  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'GYM Tracker',
        importance: Notifications.AndroidImportance.MAX,
        lightColor: colors.accent,
      });
    } catch {
      // Channel creation failed — pushes still arrive on the system default.
    }
  }
}

// ════════════════════════════════════════════════════════════════
// Native FCM push-token registration (buddy pushes).
//
// We use the DEVICE (native FCM) token, not the Expo token, so our own
// server can send via the Firebase Admin SDK directly — no Expo/EAS account
// needed. Requires google-services.json baked into the Android build.
// ════════════════════════════════════════════════════════════════

/**
 * A sign-out's unregister that is still in flight. Registration awaits it so
 * a stale server-side delete can never evict the fresh registration of the
 * same device token (same account signing straight back in).
 */
let pendingUnregister: Promise<boolean> | null = null;

/**
 * getDevicePushTokenAsync can pend forever (e.g. APNs registration with no
 * network) — bound it so the sign-out chain behind it always proceeds.
 */
const DEVICE_TOKEN_TIMEOUT_MS = 5_000;

/** This device's native FCM token, or null when unavailable within the bound. */
async function currentDeviceToken(): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), DEVICE_TOKEN_TIMEOUT_MS);
  });
  const tokenResponse = await Promise.race([
    Notifications.getDevicePushTokenAsync(),
    timeout,
  ]);
  if (!tokenResponse) return null;
  const deviceToken = typeof tokenResponse.data === 'string' ? tokenResponse.data : '';
  return deviceToken || null;
}

/**
 * Register this device's native FCM push token with the server so buddy
 * pushes can arrive. No-ops (returns false) when signed out, unsupported, or
 * permission is denied. Never throws — the app works fine without remote push
 * (local reminders are unaffected).
 */
export async function registerForPushNotificationsAsync(): Promise<boolean> {
  if (!isSupported()) return false;

  // Let a just-fired sign-out unregister finish first, so its server-side
  // delete lands before (not after) the registration we're about to make.
  if (pendingUnregister) await pendingUnregister;

  const auth = useAuth.getState();
  if (auth.status !== 'signedIn' || auth.token === null) return false;

  try {
    const granted = await requestPermission();
    if (!granted) return false;

    // Native device token = the raw FCM token on Android (Firebase must be
    // configured via google-services.json at build time for this to resolve).
    const tokenResponse = await Notifications.getDevicePushTokenAsync();
    const deviceToken =
      typeof tokenResponse.data === 'string' ? tokenResponse.data : '';
    if (!deviceToken) return false;

    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerPushToken(deviceToken, platform, auth.token);
    return true;
  } catch {
    // Denied permission, offline, Firebase not configured, or unauthorized.
    return false;
  }
}

/**
 * Sign-out counterpart: tell the server to forget this device's FCM token so
 * the account signing out stops receiving buddy pushes here. Takes the auth
 * token explicitly because it runs during sign-out, after local auth state
 * is already cleared. Best-effort, never throws.
 */
export function unregisterPushNotificationsAsync(authToken: string): Promise<boolean> {
  const task = doUnregisterPush(authToken);
  pendingUnregister = task;
  void task.finally(() => {
    if (pendingUnregister === task) pendingUnregister = null;
  });
  return task;
}

async function doUnregisterPush(authToken: string): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    const deviceToken = await currentDeviceToken();
    if (!deviceToken) return false;
    await unregisterPushToken(deviceToken, authToken);
    return true;
  } catch {
    // No token, Firebase not configured, offline — nothing to unregister.
    return false;
  }
}

// ════════════════════════════════════════════════════════════════
// Recurring local reminders (workout schedule / morning / weekly check-in).
// All use stable ids and cancel-then-reschedule so they stay idempotent and
// keep working with the app fully closed.
// ════════════════════════════════════════════════════════════════

/** Sunday-first day names, indexed by weekday (1=Sun … 7=Sat). */
const DAY_NAME: Record<number, string> = {
  1: 'Sunday',
  2: 'Monday',
  3: 'Tuesday',
  4: 'Wednesday',
  5: 'Thursday',
  6: 'Friday',
  7: 'Saturday',
};

/**
 * Schedule one weekly notification per selected weekday at hour:minute.
 * Cancels the whole prior set first, so calling this again fully replaces the
 * schedule (drop a day → its reminder disappears). Requests permission once.
 * Returns true if at least one reminder was scheduled.
 */
export async function scheduleWorkoutReminders(
  weekdays: number[],
  hour: number,
  minute: number,
): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    // Always clear the existing set first (covers 1..7).
    await cancelWorkoutReminders();
    if (weekdays.length === 0) return false;

    const granted = await requestPermission();
    if (!granted) return false;

    for (const weekday of weekdays) {
      if (weekday < 1 || weekday > 7) continue;
      const day = DAY_NAME[weekday] ?? 'today';
      await Notifications.scheduleNotificationAsync({
        identifier: `${WORKOUT_REMINDER_PREFIX}${weekday}`,
        content: {
          title: 'Gym time 💪',
          body: `${day}'s session is waiting`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour,
          minute,
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Cancel every per-weekday workout reminder (1..7). Never throws. */
export async function cancelWorkoutReminders(): Promise<void> {
  if (!isSupported()) return;
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    try {
      await Notifications.cancelScheduledNotificationAsync(
        `${WORKOUT_REMINDER_PREFIX}${weekday}`,
      );
    } catch {
      // no-op — nothing to cancel for this weekday.
    }
  }
}

/**
 * Daily "ready to train?" morning nudge. When `enabled`, (re)schedules a daily
 * notification at hour:minute; when disabled, cancels it. Idempotent, crash-safe.
 */
export async function scheduleMorningNudge(
  enabled: boolean,
  hour: number,
  minute: number,
): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    await Notifications.cancelScheduledNotificationAsync(MORNING_NUDGE_ID);
    if (!enabled) return false;

    const granted = await requestPermission();
    if (!granted) return false;

    await Notifications.scheduleNotificationAsync({
      identifier: MORNING_NUDGE_ID,
      content: {
        title: 'Good morning',
        body: 'Ready to train?',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Weekly Sunday-morning GM check-in reminder (09:00). When `enabled`,
 * (re)schedules it; when disabled, cancels it. Idempotent, crash-safe.
 */
export async function scheduleCheckInReminder(enabled: boolean): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    await Notifications.cancelScheduledNotificationAsync(CHECK_IN_REMINDER_ID);
    if (!enabled) return false;

    const granted = await requestPermission();
    if (!granted) return false;

    await Notifications.scheduleNotificationAsync({
      identifier: CHECK_IN_REMINDER_ID,
      content: {
        title: 'Sunday check-in',
        body: 'Your check-in with Greece is ready',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: 1, // Sunday
        hour: 9,
        minute: 0,
      },
    });
    return true;
  } catch {
    return false;
  }
}
