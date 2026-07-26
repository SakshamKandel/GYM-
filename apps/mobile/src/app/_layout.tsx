import { Oswald_400Regular, Oswald_500Medium } from '@expo-google-fonts/oswald';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@gym/ui-tokens';
import { hydrateCheckIns } from '../features/checkin/store';
import { getNotifications } from '../features/notifications/api';
import { registerPushRefresh } from '../features/realtime/pushRefresh';
import { AppLock } from '../features/security/AppLock';
import { AppStartupScreen } from '../components/experience/AppStartupScreen';
import { ErrorBoundary } from '../components/experience/ErrorBoundary';
import { StorageGate } from '../components/experience/StorageGate';
import { syncWorkouts } from '../features/sync/workoutSync';
import { startMemberDataSync, syncMemberData } from '../features/sync/memberDataSync';
import {
  registerForPushNotificationsAsync,
  setNotificationBadgeCount,
  setupNotifications,
} from '../lib/notifications';
import { startProfileSync } from '../lib/profileSync';
import { useAuth } from '../state/auth';

void SplashScreen.preventAutoHideAsync();

// Fonts are bundled locally and normally arrive almost immediately. Keep a
// short cap nonetheless: a delayed font request must not look like a frozen
// black launch screen on a cold start.
const FONT_LOAD_FALLBACK_MS = 750;

/**
 * Mirror the server's unread count onto the app-icon badge, so notifications
 * that arrived while the app was closed are visible from the home screen; a
 * null token (signed out) clears it. The inbox screen keeps it in step from
 * there (and zeroes it on "mark all read").
 *
 * Best-effort and fully swallowed: a failure just leaves the previous badge in
 * place. The try/catch also covers `lib/notifications`' web build, whose stub
 * has no badge function (web has no app icon to badge).
 */
async function syncNotificationBadge(authToken: string | null): Promise<void> {
  try {
    if (authToken === null) {
      await setNotificationBadgeCount(0);
      return;
    }
    // limit=1 — only `unreadCount` is used; the rows are the inbox's job.
    const page = await getNotifications(authToken, { limit: 1 });
    if (useAuth.getState().token !== authToken) return;
    await setNotificationBadgeCount(page.unreadCount);
  } catch {
    // Offline / unauthorized / no badge support — nothing to show.
  }
}

export default function RootLayout() {
  const [fontFallbackReady, setFontFallbackReady] = useState(false);
  const [fontsLoaded, fontsError] = useFonts({
    Oswald_400Regular,
    Oswald_500Medium,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  useEffect(() => {
    const timeout = setTimeout(() => setFontFallbackReady(true), FONT_LOAD_FALLBACK_MS);
    return () => clearTimeout(timeout);
  }, []);

  // The first React frame is always AppStartupScreen, so it is safe to release
  // the native splash immediately instead of holding a dark static frame while
  // fonts settle in the background.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  // Catch up on anything that moved while the app was away.
  //
  // The session re-validation deliberately is NOT here: features/realtime/
  // pushRefresh.ts installs its own 'active' listener that already calls
  // useAuth.refresh() (debounced), so doing it here too meant every single
  // foreground fired two identical GET /api/me + staff probes. One listener
  // owns that job now; this one keeps the local sync and the icon badge.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncMemberData();
        // Notifications may have arrived (and been read elsewhere) while we
        // were backgrounded — keep the app-icon badge honest.
        void syncNotificationBadge(useAuth.getState().token);
      }
    });
    return () => sub.remove();
  }, []);

  // Repository writes call this post-commit hook; transport stays entirely
  // outside the <100ms offline-first write path.
  useEffect(() => startMemberDataSync(), []);

  // Keep the cloud profile backup current while signed in.
  useEffect(() => {
    startProfileSync();
  }, []);

  // Notification foundation: install the foreground handler + Android
  // 'default' channel once on mount (the push server targets that channel).
  useEffect(() => {
    void setupNotifications();
  }, []);

  // Register the device's FCM push token whenever the SESSION changes.
  //
  // Keyed on the auth TOKEN, not the status string: switching accounts over a
  // live session goes signedIn → signedIn, so a status-keyed effect never
  // re-fired and the device stayed registered to the PREVIOUS account — the
  // new user kept receiving the old user's notifications. The token changes on
  // every identity change (and on rehydrate), so this now re-registers each
  // time. Registration itself is safe to re-enter: it awaits any in-flight
  // sign-out unregister first, re-reads auth after every await, and the server
  // upserts on the device token (so the row moves to the new account).
  //
  // Fire-and-forget: it never throws and no-ops when signed out. Default (no
  // options) is CHECK-ONLY — it never shows an OS permission dialog on a cold
  // start; only surfaces the user just tapped may prompt (see lib/notifications).
  const authToken = useAuth((s) => s.token);
  const prevAuthToken = useRef<string | null>(null);
  useEffect(() => {
    const previous = prevAuthToken.current;
    prevAuthToken.current = authToken;
    if (authToken === null) {
      // Signed OUT (not merely "not signed in yet" — a cold start runs this
      // with a null token before the persisted session rehydrates, and
      // clearing then would wipe a correct badge while offline). The app icon
      // must not keep advertising the previous account's unread count.
      if (previous !== null) void syncNotificationBadge(null);
      return;
    }
    if (useAuth.getState().status !== 'signedIn') return;
    void registerForPushNotificationsAsync();
    // Drain the unsynced-workout backlog and reconcile check-in due-state.
    // Keyed to the session (not mount) because the persisted 'signedIn' state
    // rehydrates from AsyncStorage AFTER mount — a mount-only call would race
    // rehydration and no-op on every cold start, leaving offline workouts
    // stuck until the next finish(). This also covers fresh sign-ins.
    void syncWorkouts();
    void syncMemberData();
    void hydrateCheckIns();
    // Push→refresh listeners (coach review / check-in reply pushes trigger
    // an immediate store re-fetch). Registers once; later calls no-op.
    registerPushRefresh();
    void syncNotificationBadge(authToken);
  }, [authToken]);

  if (!fontsLoaded && !fontsError && !fontFallbackReady) {
    return <AppStartupScreen message="Loading your training" />;
  }

  return (
    // Two nested boundaries. The inner one keeps a screen that throws from
    // taking down the providers and the app lock with it, so "Try again"
    // remounts just the route stack; the outer one catches anything that
    // escapes (a provider, the lock itself) instead of leaving a blank app
    // with no way back.
    <ErrorBoundary area="root">
    {/* Required for GestureDetector-based gestures (Stepper drag) app-wide. */}
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Explicit provider + synchronous initial metrics: without this,
          useSafeAreaInsets can report 0 on Android edge-to-edge devices
          (Android 15 forces drawing under the system bar), which sat the
          floating tab dock ON TOP of the 3-button navigation bar. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" />
      <AppLock>
      <StorageGate>
      <ErrorBoundary area="screens">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          // The platform's own push, not a bottom fade. Every screen used to
          // arrive by fading up from the bottom and then leave sideways under
          // the iOS swipe-back gesture, so the way in never matched the way
          // out. 'default' gives iOS its horizontal slide (the motion the
          // swipe-back interruptibly drives) and Android its system
          // transition, and the duration comes from the platform too.
          animation: 'default',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="workout" options={{ gestureEnabled: false }} />
        {/* Staff console — a top-level route OUTSIDE the (tabs) onboarding gate. */}
        <Stack.Screen name="staff" />
      </Stack>
      </ErrorBoundary>
      </StorageGate>
      </AppLock>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
