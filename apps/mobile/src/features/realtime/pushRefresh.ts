import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { hydrateCheckIns } from '../checkin/store';
import { refreshServerSuggestions } from '../progression/hooks';
import { useAuth } from '../../state/auth';

/**
 * Push-driven instant refresh — the "realtime" feel without websockets.
 *
 * The server sends a best-effort FCM DATA push (payload `{ type, ... }`) on
 * every coach mutation that affects this member. When one arrives while the
 * app is foregrounded (received listener) or is tapped from the tray
 * (response listener), the matching store re-fetches immediately instead of
 * waiting for the next focus/poll. A plain AppState 'active' listener also
 * quietly refreshes the same stores on every return from background.
 *
 * Everything here is silent and non-blocking: refreshes are fire-and-forget,
 * already no-op when signed out or mid-flight, and swallow their own failures
 * — a push can only ever make data fresher, never surface an error.
 *
 * Event type → refresh:
 *  - 'suggestion_reviewed'                → refreshServerSuggestions()
 *    (always re-fetches; the only guard is an in-flight dedupe).
 *  - 'checkin_reply' / 'coach_checkin_reply' → hydrateCheckIns()
 *    (the route ships the former; the latter is legacy wire-compat only).
 *  - 'coach_message' → no store to refresh. The chat thread lives in
 *    useCoachThread's component state and reloads on screen focus, so the
 *    thread is already fresh whenever the member can actually see it. The
 *    system notification itself is the realtime signal here.
 *  - 'buddy_invite' / 'buddy_accept' / 'buddy_nudge' → no module refresh
 *    exists: useBuddyData is hook-local and already reloads on focus plus a
 *    12s poll while the Buddy tab is focused and foregrounded.
 */

let registered = false;

/** True only where remote notifications actually arrive (iOS/Android). */
function isSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Pull the machine-readable event type out of a notification. FCM data maps
 * are string→string; expo-notifications surfaces them on content.data in the
 * foreground, but Android tray-tapped pushes can carry them on the trigger's
 * remoteMessage instead — check both.
 */
function eventType(notification: Notifications.Notification): string | null {
  try {
    const direct = notification.request.content.data?.type;
    if (typeof direct === 'string' && direct.length > 0) return direct;
    const trigger = notification.request.trigger as unknown as {
      remoteMessage?: { data?: Record<string, unknown> };
    } | null;
    const fromTrigger = trigger?.remoteMessage?.data?.type;
    if (typeof fromTrigger === 'string' && fromTrigger.length > 0) return fromTrigger;
  } catch {
    // Malformed payload — treat as typeless and ignore.
  }
  return null;
}

/** Map one push event type to its store refresh. Unknown types no-op. */
function refreshForEvent(type: string): void {
  switch (type) {
    case 'suggestion_reviewed':
      void refreshServerSuggestions();
      break;
    case 'checkin_reply':
    case 'coach_checkin_reply':
      void hydrateCheckIns();
      break;
    default:
      // coach_message / buddy_* / future types — no store refresh needed
      // (see the module doc); the notification banner is the signal.
      break;
  }
}

function handleNotification(notification: Notifications.Notification): void {
  // Refreshes are personal data fetches — never act on a stale session.
  if (useAuth.getState().status !== 'signedIn') return;
  const type = eventType(notification);
  if (type !== null) refreshForEvent(type);
}

/**
 * Quiet catch-up whenever the app returns to the foreground: the member may
 * have missed pushes while backgrounded (denied permission, doze, dropped
 * data-only delivery), so re-fetch the two cheap coach-facing stores.
 */
function refreshOnForeground(): void {
  if (useAuth.getState().status !== 'signedIn') return;
  void hydrateCheckIns();
  void refreshServerSuggestions();
}

/**
 * Install the push→refresh listeners exactly once for the app's lifetime.
 * Called from the root layout on the first signed-in transition; subsequent
 * calls (fresh sign-ins, hot reload re-renders) no-op via the module guard,
 * and the handlers themselves re-check auth on every event — so the
 * subscriptions can safely outlive a sign-out. Never throws.
 */
export function registerPushRefresh(): void {
  if (registered || !isSupported()) return;
  registered = true;
  try {
    // Foreground: a push arrived while the member is in the app — refresh the
    // matching store right away so the UI updates without a banner tap.
    Notifications.addNotificationReceivedListener(handleNotification);
    // Tap: the member opened the app from the tray — make the target screen's
    // data fresh before (or as) it renders.
    Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotification(response.notification);
    });
  } catch {
    // Notifications module unavailable — foreground refresh still works.
  }
  try {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshOnForeground();
    });
  } catch {
    // AppState unavailable (should never happen) — pushes still refresh.
  }
}
