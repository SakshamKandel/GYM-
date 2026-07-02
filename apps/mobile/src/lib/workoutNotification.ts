import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * The "ongoing workout" notification — the Android/Samsung equivalent of a
 * Live Activity. While a workout is active we keep ONE persistent (ongoing,
 * non-swipeable) notification in the status bar / pull-down shade showing the
 * live state: the current exercise plus a rest countdown, or "Workout in
 * progress". The user can glance at their rest timer without opening the app.
 *
 * Self-contained + crash-safe:
 *  - Android is the only target. iOS/web are safe no-ops (ongoing status-bar
 *    notifications are an Android concept; on iOS this would just be a normal
 *    banner, which is not what we want mid-workout).
 *  - Never throws into the UI — every call is wrapped in try/catch.
 *  - We do NOT request permission here. The app's setupNotifications() owns
 *    permission; we only present when already permitted. Presenting without
 *    permission simply no-ops/throws and we swallow it.
 *  - Its OWN stable identifier ('active-workout') so presenting again UPDATES
 *    the same notification in place. Its OWN channel ('workout') at LOW
 *    importance so it's silent and persistent, never buzzing.
 */

/** Stable id — presenting with this again replaces/updates the notification. */
const ACTIVE_WORKOUT_ID = 'active-workout';
/** Dedicated silent channel so this never pings the rest of the app's config. */
const WORKOUT_CHANNEL_ID = 'workout';

/** Only Android shows an ongoing status-bar notification here. */
function isSupported(): boolean {
  return Platform.OS === 'android';
}

/** Ensure the silent 'workout' channel exists. Created lazily on first show. */
let channelReady = false;
async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  try {
    await Notifications.setNotificationChannelAsync(WORKOUT_CHANNEL_ID, {
      name: 'Active workout',
      // LOW = shown silently in the shade, no heads-up pop, no sound/vibrate —
      // exactly what a persistent "in progress" chip should be.
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      showBadge: false,
    });
    channelReady = true;
  } catch {
    // Channel API unavailable — leave channelReady false so we retry next time.
  }
}

/**
 * Present (or update) the ongoing notification with an explicit body. Shared by
 * showActiveWorkout/updateRest. Same identifier → updates in place. `sticky`
 * makes it non-swipeable; `autoDismiss:false` keeps it if tapped; `sound:false`
 * keeps it silent. The channelId trigger presents immediately on Android.
 */
async function present(body: string): Promise<void> {
  if (!isSupported()) return;
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: ACTIVE_WORKOUT_ID,
      content: {
        title: 'Workout in progress',
        body,
        sticky: true,
        autoDismiss: false,
        sound: false,
      },
      trigger: { channelId: WORKOUT_CHANNEL_ID },
    });
  } catch {
    // Not permitted / module unavailable — silently no-op.
  }
}

export interface ShowActiveWorkoutInput {
  workoutName: string;
  /** Pre-formatted elapsed time, e.g. "12:34". */
  elapsedLabel: string;
}

/**
 * Present the ongoing notification for a freshly-active workout. Body reads
 * "{workoutName} · {elapsedLabel}". Calling again with the same id updates it.
 */
export async function showActiveWorkout(input: ShowActiveWorkoutInput): Promise<void> {
  await present(`${input.workoutName} · ${input.elapsedLabel}`);
}

export interface UpdateRestInput {
  workoutName: string;
  /** Pre-formatted remaining rest, e.g. "0:45". Null when not resting. */
  restRemainingLabel: string | null;
  /** Pre-formatted elapsed time, e.g. "12:34". */
  elapsedLabel: string;
}

/** Minimum gap between presented updates — the rest timer ticks every second,
 * but the system should not be spammed, so we throttle to ~once per 3s. */
const UPDATE_THROTTLE_MS = 3000;
let lastPresentedAt = 0;
/** Remember the last body so a forced/critical change can still be detected. */
let lastBody: string | null = null;

/**
 * Update the ongoing notification from the workout's live state. When resting,
 * body = "Resting {restRemainingLabel} · {workoutName}"; otherwise body =
 * "{workoutName} · {elapsedLabel}".
 *
 * THROTTLED internally to at most ~once per 3s so calling this from the 1s tick
 * is safe. A change between resting↔not-resting bypasses the throttle so the
 * user sees the rest state flip promptly (start/end of a rest).
 */
export async function updateRest(input: UpdateRestInput): Promise<void> {
  if (!isSupported()) return;
  const resting = input.restRemainingLabel !== null;
  const body = resting
    ? `Resting ${input.restRemainingLabel} · ${input.workoutName}`
    : `${input.workoutName} · ${input.elapsedLabel}`;

  const now = Date.now();
  // Detect a rest-state flip (resting↔not) vs. a mere countdown tick so the
  // start/end of a rest updates immediately instead of waiting on the throttle.
  const prevResting = lastBody !== null && lastBody.startsWith('Resting ');
  const stateFlipped = prevResting !== resting;
  if (!stateFlipped && now - lastPresentedAt < UPDATE_THROTTLE_MS) return;
  if (body === lastBody) return;

  lastPresentedAt = now;
  lastBody = body;
  await present(body);
}

/** Dismiss the ongoing notification and cancel its request. Never throws. */
export async function clearActiveWorkout(): Promise<void> {
  // Reset throttle state so the next workout starts clean.
  lastPresentedAt = 0;
  lastBody = null;
  if (!isSupported()) return;
  try {
    await Notifications.dismissNotificationAsync(ACTIVE_WORKOUT_ID);
  } catch {
    // Nothing presented, or module unavailable.
  }
  try {
    await Notifications.cancelScheduledNotificationAsync(ACTIVE_WORKOUT_ID);
  } catch {
    // Nothing scheduled, or module unavailable.
  }
}
