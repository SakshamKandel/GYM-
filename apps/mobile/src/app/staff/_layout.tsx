import { Stack } from 'expo-router';
import { colors } from '@gym/ui-tokens';

/**
 * Staff console stack. Lives at `/staff/*`, a sibling of `(tabs)` — so it is
 * NOT behind the athlete onboarding gate and a signed-in staff member reaches
 * it straight from sign-in.
 *
 * Headerless (each screen draws its own back row via the UI kit, matching the
 * rest of the app) with a charcoal background so there is no white flash on
 * push. Screen agents add their routes as files under this directory; they are
 * picked up automatically and inherit these options.
 */
export default function StaffLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade_from_bottom',
        animationDuration: 180,
      }}
    />
  );
}
