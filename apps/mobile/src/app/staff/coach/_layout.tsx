import { Redirect, Stack } from 'expo-router';
import { colors } from '@gym/ui-tokens';
import { useAuth } from '../../../state/auth';
import { canOpenCoachConsole, STAFF_ROUTES } from '../../../features/staff/nav';

/**
 * Coach console stack — the coach messaging surface at `/staff/coach/*`.
 *
 * Redirect guard (defects G2/G6): only COACH_CONSOLE_ROLES (coach + super/main —
 * the shared matrix) may enter. Any other staff role that deep-links here
 * bounces to the staff hub instead of a dead thread. The parent `/staff` layout
 * already guarantees an active staff session, so this only re-checks the
 * console-level role.
 *
 * Nested under the staff Stack, so it inherits the charcoal, headerless shell
 * but keeps its own child screens (inbox + per-client thread) grouped. Each
 * screen draws its own back row via the UI kit; no native header.
 */
export default function CoachLayout() {
  const staffPermissions = useAuth((s) => s.staffPermissions);

  if (!canOpenCoachConsole(staffPermissions)) {
    return <Redirect href={STAFF_ROUTES.hub as '/staff'} />;
  }

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
