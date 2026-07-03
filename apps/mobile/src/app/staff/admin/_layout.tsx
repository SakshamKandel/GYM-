import { Stack } from 'expo-router';
import { colors } from '@gym/ui-tokens';

/**
 * Admin console stack — nested under the staff stack at `/staff/admin/*`.
 *
 * Inherits the headerless charcoal treatment of its parent (each screen draws
 * its own back row via the UI kit), and re-declares the same options here so
 * the admin sub-tree stays visually identical even if the parent stack changes.
 * Screen agents drop files under this directory and they are picked up
 * automatically.
 */
export default function AdminLayout() {
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
