import { AppState, Platform } from 'react-native';
import {
  registerNotificationListeners,
  type PushRefreshNotification,
} from './notificationListeners';
import { hydrateCheckIns } from '../checkin/store';
import { useGamificationBadges } from '../gamification/store';
import { triggerMyCoachRefresh } from '../mentorship/hooks';
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
 *  - 'badge_verified' / 'badge_earned' → useGamificationBadges.hydrate()
 *    (coach verified a strength-club badge, or the award engine granted a new
 *    one — e.g. buddy quest, coach's pick, challenge complete). Re-fetching
 *    also refreshes newlyEarnedIds so the Badges screen's celebration can
 *    fire next time it's focused.
 *  - 'coach' → triggerMyCoachRefresh() (WP-10's `coach_unassigned` push: a
 *    coach released this member). `useMyCoach()` has no global store of its
 *    own, so this calls every mounted instance's `reload` directly instead
 *    — the unassign banner on coach-chat.tsx (and any other screen reading
 *    `useMyCoach`) updates immediately rather than waiting for a focus event.
 *  - 'coach_message' → no store to refresh. The chat thread lives in
 *    useCoachThread's component state and reloads on screen focus, so the
 *    thread is already fresh whenever the member can actually see it. The
 *    system notification itself is the realtime signal here.
 *  - 'support_reply' → deliberate no-op since the buddy feature (and its
 *    shared unread store) was removed: the Settings Support-row badge does
 *    its own focus fetch (features/support/api getSupportUnread) and the
 *    open support thread reloads on focus/poll, same as coach_message above.
 *    The system notification itself is the realtime signal.
 *  - 'application_decided' / 'tier_request_decided' / 'payment_decided' →
 *    useAuth.getState().refresh() (the same GET /api/me the debounced
 *    foreground catch-up uses). All three flip server-side state that only
 *    that endpoint returns — accounts.tier (payment approval) or the coach
 *    role / coachTier (application or tier-request decision) — so without
 *    this the paywall, the coaches tab's "Become a coach" entry, and the
 *    staff console's visibility all stay stale until an unrelated refresh
 *    happens to fire.
 *  - 'coach_plan' → intentionally a documented no-op FOR NOW: the assigned-
 *    workouts/diet sections (features/training/coachWorkouts.ts,
 *    features/nutrition/coachDiet.ts) are hook-local state that already
 *    reloads on focus, and neither exports a global store yet (their own doc
 *    comments note this file is off-limits to that workstream). Wire a real
 *    refresh in here if/when a shared store lands — a missing store must
 *    stay a no-op, never a crash from importing something that doesn't exist.
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
function eventType(notification: PushRefreshNotification): string | null {
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
    case 'badge_verified':
    case 'badge_earned':
      void useGamificationBadges.getState().hydrate();
      break;
    case 'application_decided':
    case 'tier_request_decided':
    case 'payment_decided':
      void useAuth.getState().refresh();
      break;
    case 'coach':
      triggerMyCoachRefresh();
      break;
    case 'coach_plan':
    // falls through — no global store exists yet (see the module doc); the
    // Train/Food sections already reload on focus.
    default:
      // coach_message / support_reply / future types — no store refresh
      // needed (see the module doc); the notification banner is the signal.
      break;
  }
}

function handleNotification(notification: PushRefreshNotification): void {
  // Refreshes are personal data fetches — never act on a stale session.
  if (useAuth.getState().status !== 'signedIn') return;
  const type = eventType(notification);
  if (type !== null) refreshForEvent(type);
}

/**
 * Minimum gap between foreground catch-ups. On web a single foreground can
 * fire AppState 'active' + visibilitychange + window focus back-to-back, and
 * on native quick app switches would otherwise stack identical fetches.
 */
const FOREGROUND_CATCHUP_MIN_MS = 30_000;

let lastCatchupAt = 0;

/**
 * Quiet catch-up whenever the app returns to the foreground: the member may
 * have missed pushes while backgrounded (denied permission, doze, dropped
 * data-only delivery — and web gets no pushes at all), so re-validate the
 * session and re-fetch the two cheap coach-facing stores. The auth refresh
 * is what keeps the server tier / staff role from going stale until reload:
 * it's one GET /api/me with stale-token guards and a health-probe-gated 401.
 * Debounced so foreground bursts collapse into one round of calls.
 */
function refreshOnForeground(): void {
  if (useAuth.getState().status !== 'signedIn') return;
  const now = Date.now();
  if (now - lastCatchupAt < FOREGROUND_CATCHUP_MIN_MS) return;
  lastCatchupAt = now;
  void useAuth.getState().refresh();
  void hydrateCheckIns();
  void refreshServerSuggestions();
}

/**
 * Web foreground signals. React Native Web maps AppState onto the page
 * visibility API, but 'active' rarely fires in practice (the page usually
 * starts visible and some browsers never flip it) — so hook the DOM events
 * directly: visibilitychange for tab switches, window focus for window
 * switches. Guarded lookups because tsc also checks this file for native.
 */
function registerWebForegroundListeners(): void {
  const g = globalThis as {
    document?: {
      visibilityState?: string;
      addEventListener?: (type: string, listener: () => void) => void;
    };
    addEventListener?: (type: string, listener: () => void) => void;
  };
  try {
    g.document?.addEventListener?.('visibilitychange', () => {
      if (g.document?.visibilityState === 'visible') refreshOnForeground();
    });
    g.addEventListener?.('focus', () => refreshOnForeground());
  } catch {
    // No DOM (SSR pass) — the AppState listener still covers what it can.
  }
}

/**
 * Install the push→refresh listeners exactly once for the app's lifetime.
 * Called from the root layout on the first signed-in transition; subsequent
 * calls (fresh sign-ins, hot reload re-renders) no-op via the module guard,
 * and the handlers themselves re-check auth on every event — so the
 * subscriptions can safely outlive a sign-out. Never throws.
 *
 * Push-token listeners are native-only, but the foreground catch-up installs
 * on EVERY platform — the old early-return for unsupported platforms meant
 * web never caught up until a full page reload.
 */
export function registerPushRefresh(): void {
  if (registered) return;
  registered = true;
  if (isSupported()) {
    try {
      registerNotificationListeners(handleNotification);
    } catch {
      // Notifications module unavailable — foreground refresh still works.
    }
  }
  try {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshOnForeground();
    });
  } catch {
    // AppState unavailable (should never happen) — pushes still refresh.
  }
  if (Platform.OS === 'web') registerWebForegroundListeners();
}
