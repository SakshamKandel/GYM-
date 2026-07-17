import { Redirect, Stack } from 'expo-router';
import { colors } from '@gym/ui-tokens';
import { useAuth } from '../../../state/auth';
import { canOpenAdminConsole, STAFF_ROUTES } from '../../../features/staff/nav';

/**
 * Admin console stack — nested under the staff stack at `/staff/admin/*`.
 *
 * Redirect guard (defects G2/G6): only ADMIN_CONSOLE_ROLES (super/main/member/
 * content/support — the shared matrix) may enter. A plain coach or a
 * nutrition_admin who deep-links here bounces to the staff hub (their own
 * console, if any) instead of hitting a per-screen 403 trap. The parent
 * `/staff` layout already guarantees an active staff session, so this only has
 * to re-check the console-level role.
 *
 * Inherits the headerless charcoal treatment of its parent (each screen draws
 * its own back row via the UI kit), and re-declares the same options here so
 * the admin sub-tree stays visually identical even if the parent stack changes.
 * Screen agents drop files under this directory and they are picked up
 * automatically.
 */
export default function AdminLayout() {
  const staffPermissions = useAuth((s) => s.staffPermissions);

  if (!canOpenAdminConsole(staffPermissions)) {
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
