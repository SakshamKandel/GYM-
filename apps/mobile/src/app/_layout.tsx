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
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '@gym/ui-tokens';
import { hydrateCheckIns } from '../features/checkin/store';
import { registerPushRefresh } from '../features/realtime/pushRefresh';
import { AppLock } from '../features/security/AppLock';
import { AppStartupScreen } from '../components/experience/AppStartupScreen';
import { syncWorkouts } from '../features/sync/workoutSync';
import {
  registerForPushNotificationsAsync,
  setupNotifications,
} from '../lib/notifications';
import { startProfileSync } from '../lib/profileSync';
import { useAuth } from '../state/auth';

void SplashScreen.preventAutoHideAsync();

// Fonts are bundled locally and normally arrive almost immediately. Keep a
// short cap nonetheless: a delayed font request must not look like a frozen
// black launch screen on a cold start.
const FONT_LOAD_FALLBACK_MS = 750;

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

  // Re-validate the server session whenever the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void useAuth.getState().refresh();
    });
    return () => sub.remove();
  }, []);

  // Keep the cloud profile backup current while signed in.
  useEffect(() => {
    startProfileSync();
  }, []);

  // Notification foundation: install the foreground handler + Android
  // 'default' channel once on mount (the push server targets that channel).
  useEffect(() => {
    void setupNotifications();
  }, []);

  // Register the device's Expo push token whenever we're signed in — this
  // effect re-runs on the signedOut→signedIn transition, so a fresh sign-in
  // registers too. Fire-and-forget: it never throws and no-ops when signed out.
  const authStatus = useAuth((s) => s.status);
  useEffect(() => {
    if (authStatus === 'signedIn') {
      void registerForPushNotificationsAsync();
      // Drain the unsynced-workout backlog and reconcile check-in due-state.
      // Keyed to authStatus (not mount) because the persisted 'signedIn' state
      // rehydrates from AsyncStorage AFTER mount — a mount-only call would race
      // rehydration and no-op on every cold start, leaving offline workouts
      // stuck until the next finish(). This also covers fresh sign-ins.
      void syncWorkouts();
      void hydrateCheckIns();
      // Push→refresh listeners (coach review / check-in reply pushes trigger
      // an immediate store re-fetch). Registers once; later calls no-op.
      registerPushRefresh();
    }
  }, [authStatus]);

  if (!fontsLoaded && !fontsError && !fontFallbackReady) {
    return <AppStartupScreen message="Loading your training" />;
  }

  return (
    // Required for GestureDetector-based gestures (Stepper drag) app-wide.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <AppLock>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade_from_bottom',
          animationDuration: 180,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="workout" options={{ gestureEnabled: false }} />
        {/* Staff console — a top-level route OUTSIDE the (tabs) onboarding gate. */}
        <Stack.Screen name="staff" />
      </Stack>
      </AppLock>
    </GestureHandlerRootView>
  );
}
