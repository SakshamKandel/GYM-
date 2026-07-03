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
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '@gym/ui-tokens';
import { AppLock } from '../features/security/AppLock';
import {
  registerForPushNotificationsAsync,
  setupNotifications,
} from '../lib/notifications';
import { startProfileSync } from '../lib/profileSync';
import { useAuth } from '../state/auth';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontsError] = useFonts({
    Oswald_400Regular,
    Oswald_500Medium,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontsError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontsError]);

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
    if (authStatus === 'signedIn') void registerForPushNotificationsAsync();
  }, [authStatus]);

  if (!fontsLoaded && !fontsError) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
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
