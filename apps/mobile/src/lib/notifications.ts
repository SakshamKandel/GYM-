import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
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
 *  - Opt-in, with ONE explicit ask surface: onboarding's "Stay on track" step
 *    (`requestPermission()` / prompting `registerForPushNotificationsAsync`)
 *    and Settings toggles (workout/morning/check-in reminders, which the
 *    user just flipped, so a prompt there is expected). Everywhere else
 *    (cold-start push registration, the first-workouts quest, the streak
 *    saver) only CHECKS the current permission via `hasPermission()` — no
 *    surprise OS dialogs outside the two ask surfaces above.
 */

/** Stable id so the reminder can always be found and cancelled. */
const FIRST_WORKOUTS_REMINDER_ID = 'first-workouts-reminder';

/** Stable ids for the recurring reminder set (cancel-then-reschedule). */
const WORKOUT_REMINDER_PREFIX = 'workout-rem-';
const MORNING_NUDGE_ID = 'morning-nudge';
const CHECK_IN_REMINDER_ID = 'checkin-reminder';

/** Stable id for the weekly streak-saver nudge (cancel-then-reschedule). */
const STREAK_SAVER_ID = 'streak-saver';

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
 * Passive permission check — never shows a system prompt. Reflects whatever
 * the user already decided; callers that must not surprise the user with an
 * OS dialog (cold-start push registration, background reminder reschedules
 * outside a Settings toggle) use this instead of `requestPermission()`.
 */
async function hasPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Schedule the single "get your next workout in" reminder `daysFromNow` out.
 * Cancels any existing one first (so this is idempotent), then schedules with
 * a stable identifier — CHECK-ONLY (no OS prompt): this quest fires on its own
 * timeline, not from a user-initiated ask surface, so it must never surprise
 * the user with a permission dialog. Returns true if a notification was
 * actually scheduled.
 */
export async function scheduleFirstWorkoutsReminder(
  daysFromNow: number,
  title: string,
  body: string,
): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    const granted = await hasPermission();
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
// WP-2 deep-link switch — a tapped push's `data.type`/`data.id` → a route.
// (Pack B/P contract: "Mobile deep-link switch is owned by WP-14
// (`lib/notifications.ts`)".) Distinct from features/realtime/pushRefresh.ts,
// which maps a DIFFERENT, older set of foreground data-refresh event types
// (badge_verified, suggestion_reviewed, …) to store refreshes, not routes.
// ════════════════════════════════════════════════════════════════

/** A `data.id` field, tolerant of whatever primitive shape the payload used. */
function stringField(data: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Resolve a notification's `data` payload to an in-app route, or null when
 * there's nowhere sensible to go (an unrecognised/absent `type` — the caller
 * still marks the notification read, it just doesn't navigate).
 */
export function deepLinkForNotification(data: Record<string, unknown> | null | undefined): string | null {
  const type = stringField(data, 'type');
  if (!type) return null;
  const id = stringField(data, 'id');
  switch (type) {
    case 'order':
      return '/meals/orders';
    case 'cycle':
      return '/meals/subscriptions';
    case 'tier':
      return '/subscribe';
    case 'coach_chat':
    case 'coach':
      // 'coach' = WP-10's coach_unassigned push (a coach released this
      // member). Coach Chat is the only screen with the unassign banner +
      // "Rate coach"/"Browse coaches" follow-up actions (Pack L), so route
      // there the same as an actual chat message.
      return '/coach-chat';
    case 'support':
      return '/support';
    case 'gym':
      // Best-effort: `id` is the gym's slug when the server sent one: falls
      // back to the saved-gyms list rather than a dead route when absent.
      return id ? `/gyms/${encodeURIComponent(id)}` : '/gyms/saved';
    default:
      return null;
  }
}

let deepLinksRegistered = false;

/**
 * Install the tap→route listener exactly once. Called from
 * `setupNotifications()` (already invoked once at app start) so no other
 * file needs to change to pick this up. Foreground taps navigate
 * immediately; a cold-start tap (app was fully closed) is handled the same
 * way since expo-router mounts before this runs and `router.push` queues
 * against the not-yet-ready navigator.
 */
function registerNotificationDeepLinks(): void {
  if (deepLinksRegistered) return;
  deepLinksRegistered = true;
  try {
    Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | null
          | undefined;
        const target = deepLinkForNotification(data);
        if (target) router.push(target as Href);
      } catch {
        // Malformed payload — nothing to navigate to.
      }
    });
  } catch {
    // Notifications module unavailable — the in-app notification center's
    // own tap handling still works.
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
  registerNotificationDeepLinks();
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
 *
 * `askIfUndetermined` (default false) picks which permission check gates
 * registration:
 *  - false (cold start, `_layout.tsx`): `hasPermission()` only — never shows
 *    an OS dialog; silently skips registration until permission is granted
 *    elsewhere (onboarding or a Settings toggle).
 *  - true (onboarding's "Stay on track" step): `requestPermission()` — shows
 *    the OS dialog when undetermined. Resolved BEFORE the signed-in check
 *    because onboarding runs signed out; the prompt must fire regardless of
 *    session state, even though token registration itself still requires one.
 */
export async function registerForPushNotificationsAsync(
  options: { askIfUndetermined?: boolean } = {},
): Promise<boolean> {
  const { askIfUndetermined = false } = options;
  if (!isSupported()) return false;

  // Let a just-fired sign-out unregister finish first, so its server-side
  // delete lands before (not after) the registration we're about to make.
  if (pendingUnregister) await pendingUnregister;

  try {
    const granted = askIfUndetermined ? await requestPermission() : await hasPermission();
    if (!granted) return false;

    const auth = useAuth.getState();
    if (auth.status !== 'signedIn' || auth.token === null) return false;
    // Snapshot the account we're registering for; re-verified after every await
    // below so a sign-out mid-flight can never be overtaken by this register.
    const authToken = auth.token;

    // Native device token = the raw FCM token on Android (Firebase must be
    // configured via google-services.json at build time for this to resolve).
    // Bounded (5s) like currentDeviceToken so a hung native call can't leave
    // a registration pending indefinitely across a sign-out.
    const deviceToken = await currentDeviceToken();
    if (!deviceToken) return false;

    // Re-read auth AFTER the awaits: if the user signed out (or switched
    // accounts) while the token fetch was in flight, abort so we don't
    // re-register the device to the just-signed-out account.
    const latest = useAuth.getState();
    if (latest.status !== 'signedIn' || latest.token !== authToken) return false;

    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerPushToken(deviceToken, platform, authToken);
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

// ════════════════════════════════════════════════════════════════
// Weekly streak-saver nudge — a same-day, one-shot local reminder when the
// current week is short on session-days with little time left. Scheduled
// from features/streak/hooks.ts on app-open focus (no server cron per the
// gamification contract); cancelled once the week's target is met.
// ════════════════════════════════════════════════════════════════

/** 19:00 local, or ~2h from now if it's already past 19:00 today. */
function streakSaverSecondsFromNow(): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(19, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setTime(now.getTime() + 2 * 60 * 60 * 1000);
  }
  return Math.max(60, Math.round((target.getTime() - now.getTime()) / 1000));
}

/**
 * Schedule (or replace) the evening streak-saver reminder: "N sessions left
 * to keep your M-week streak". Idempotent (cancels any prior copy first).
 * Callers only invoke this when the week is genuinely short — see
 * features/streak/hooks.ts for the trigger condition. CHECK-ONLY (no OS
 * prompt): this fires from app-open focus, not a user-initiated ask surface.
 */
export async function scheduleStreakSaverReminder(
  sessionsLeft: number,
  streakWeeks: number,
): Promise<boolean> {
  if (!isSupported()) return false;
  if (sessionsLeft <= 0) return false;
  try {
    await Notifications.cancelScheduledNotificationAsync(STREAK_SAVER_ID);

    const granted = await hasPermission();
    if (!granted) return false;

    const sessionWord = sessionsLeft === 1 ? 'session' : 'sessions';
    const body =
      streakWeeks > 0
        ? `${sessionsLeft} ${sessionWord} left to keep your ${streakWeeks}-week streak`
        : `${sessionsLeft} ${sessionWord} left to hit your weekly target`;

    await Notifications.scheduleNotificationAsync({
      identifier: STREAK_SAVER_ID,
      content: { title: 'Keep your streak alive', body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: streakSaverSecondsFromNow(),
        repeats: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Cancel the streak-saver reminder (e.g. the week's target was already met). */
export async function cancelStreakSaverReminder(): Promise<void> {
  if (!isSupported()) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(STREAK_SAVER_ID);
  } catch {
    // no-op — nothing to cancel or module unavailable.
  }
}

/**
 * Weekly Sunday-morning GM check-in reminder (09:00). When `enabled`,
 * (re)schedules it; when disabled, cancels it. Idempotent, crash-safe.
 *
 * `coachName` is the member's currently-assigned coach's display name (or
 * null/undefined if they have none assigned, or it's not known at call
 * time). The body is data-driven from it rather than a hardcoded name — a
 * member with no coach, or a coach other than a hardcoded default, must
 * never see the wrong (or nonexistent) identity in this reminder.
 */
export async function scheduleCheckInReminder(
  enabled: boolean,
  coachName?: string | null,
): Promise<boolean> {
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
        body: coachName ? `Your check-in with ${coachName} is ready` : 'Your weekly check-in is ready',
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
