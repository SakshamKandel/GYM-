import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { colors } from '@gym/ui-tokens';
import { registerPushToken } from './api/client';
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
// Expo push-token registration (buddy pushes).
// ════════════════════════════════════════════════════════════════

/** Read the EAS project id from app config; undefined in dev builds. */
function readProjectId(): string | undefined {
  // `expoConfig.extra` is typed as `{ [k: string]: any }`, so narrow via
  // `unknown` to keep strict mode honest (no `any` leaks out of here).
  const extra: unknown = Constants.expoConfig?.extra;
  if (extra !== null && typeof extra === 'object' && 'eas' in extra) {
    const eas: unknown = (extra as Record<string, unknown>)['eas'];
    if (eas !== null && typeof eas === 'object' && 'projectId' in eas) {
      const id: unknown = (eas as Record<string, unknown>)['projectId'];
      if (typeof id === 'string' && id.length > 0) return id;
    }
  }
  return undefined;
}

/**
 * Register this device's Expo push token with the server so buddy pushes can
 * arrive. No-ops (returns false) when signed out, unsupported, or permission
 * is denied. Never throws.
 *
 * NOTE: `getExpoPushTokenAsync` needs an EAS `projectId`, normally read from
 * `Constants.expoConfig.extra.eas.projectId`. Local/dev builds may lack one —
 * we still attempt the call (Expo can infer it in some contexts) and simply
 * swallow the failure, returning false, if it can't.
 */
export async function registerForPushNotificationsAsync(): Promise<boolean> {
  if (!isSupported()) return false;

  const auth = useAuth.getState();
  if (auth.status !== 'signedIn' || auth.token === null) return false;

  try {
    const granted = await requestPermission();
    if (!granted) return false;

    const projectId = readProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId !== undefined ? { projectId } : undefined,
    );
    const expoToken = tokenResponse.data;
    if (!expoToken) return false;

    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerPushToken(expoToken, platform, auth.token);
    return true;
  } catch {
    // Missing projectId, denied permission, offline, or unauthorized — the
    // app works fine without remote push; local reminders are unaffected.
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
