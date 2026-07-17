import { Redirect, Stack } from 'expo-router';
import { colors } from '@gym/ui-tokens';
import { useAuth } from '../../state/auth';

/**
 * Staff console stack. Lives at `/staff/*`, a sibling of `(tabs)` — so it is
 * NOT behind the athlete onboarding gate and a signed-in staff member reaches
 * it straight from sign-in.
 *
 * Redirect guard (defects G2/G6): the whole sub-tree is gated on an ACTIVE
 * staff session. If the session is signed out (including a silent 401 sign-out
 * that happens WHILE the console is open — the store flips `status`, this layout
 * re-renders and bounces out instead of stranding a permanent spinner) or the
 * account is not staff (staffRole === null), we Redirect to the member root
 * rather than render a dead console. Signed-out deep links to `/staff/*` land
 * here too and bounce cleanly.
 *
 * Headerless (each screen draws its own back row via the UI kit, matching the
 * rest of the app) with a charcoal background so there is no white flash on
 * push. Screen agents add their routes as files under this directory; they are
 * picked up automatically and inherit these options.
 */
export default function StaffLayout() {
  const status = useAuth((s) => s.status);
  const staffRole = useAuth((s) => s.staffRole);
  const staffPermissions = useAuth((s) => s.staffPermissions);

  if (status !== 'signedIn' || staffRole == null || staffPermissions.length === 0) {
    return <Redirect href="/" />;
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
