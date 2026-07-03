import { Stack } from 'expo-router';
import { colors } from '@gym/ui-tokens';

/**
 * Coach console stack — the messaging surface Greece lives in on the phone.
 *
 * Nested under the staff Stack (`/staff/coach/*`), so it inherits the charcoal,
 * headerless shell but keeps its own child screens (inbox + per-client thread)
 * grouped. Each screen draws its own back row via the UI kit; no native header.
 */
export default function CoachLayout() {
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
