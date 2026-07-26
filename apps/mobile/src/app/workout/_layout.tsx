import { Stack } from 'expo-router';
import { colors } from '@gym/ui-tokens';
import { ErrorBoundary } from '../../components/experience/ErrorBoundary';

/** Gym-mode stack — fullscreen, no tab bar, no swipe-back mid-set. */
export default function WorkoutLayout() {
  return (
    // There is no header and no back gesture in here, so a crash mid-set would
    // leave a blank screen with literally no way out. Its own boundary keeps
    // the failure local, and "Try again" remounts the logger, which rebuilds
    // itself from the local store.
    <ErrorBoundary area="workout">
      <Stack
        screenOptions={{
          headerShown: false,
          gestureEnabled: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
          animationDuration: 150,
        }}
      />
    </ErrorBoundary>
  );
}
