import { Stack } from 'expo-router';
import { colors } from '@gym/ui-tokens';

/** Gym-mode stack — fullscreen, no tab bar, no swipe-back mid-set. */
export default function WorkoutLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade',
        animationDuration: 150,
      }}
    />
  );
}
