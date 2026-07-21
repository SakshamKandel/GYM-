import { router, type Href } from 'expo-router';
import { blurActiveElement } from '../../lib/blurActiveElement';
import { resetStackTo } from '../../lib/nav';
import { useAuth } from '../../state/auth';
import { STAFF_ROUTES } from '../staff/nav';

/**
 * Typed-routes escape hatch (same pattern as features/training/nav.ts).
 * `.expo/types/router.d.ts` only regenerates when the dev server runs, so
 * routes added in this build (auth/*, subscribe) aren't in the generated
 * union yet. Centralize the cast so it's trivial to delete later.
 */
export function pushPath(path: string): void {
  blurActiveElement();
  router.push(path as Href);
}

export function replacePath(path: string): void {
  blurActiveElement();
  router.replace(path as Href);
}

/**
 * Post-sign-in landing — login is the app's front door. Staff members skip
 * the onboarding-gated root and land straight in the staff console; everyone
 * else goes to '/'. The auth store has already awaited the /api/me/staff
 * probe by the time signIn/signInWithGoogle/signUp resolves, so staffRole is
 * settled here. EVERY sign-in flow (email form AND both Google buttons) must
 * route through this — a bare router.replace('/') bounced staff accounts to
 * /welcome, which read as "login did nothing".
 *
 * Resets the WHOLE stack (not just the top route): plain replace left the
 * Welcome poster underneath, so Android back from the dashboard reopened
 * "Get started" right after signing in.
 *
 * P0-13: routing to the hub requires staffRole AND a non-empty effective
 * permission list — the SAME gate `/staff/_layout.tsx` enforces. Before this
 * fix, a staff account with a role but zero granted permissions (a stripped
 * override, or a brand-new role preset) was sent to the hub here, only for
 * the layout guard to immediately Redirect it back out to '/' — the
 * round-trip flash read as "login did nothing". Checking the same condition
 * here sends that account straight to '/' with no bounce.
 */
export function enterApp(): void {
  const { staffRole, staffPermissions } = useAuth.getState();
  const hasConsole = staffRole !== null && staffPermissions.length > 0;
  resetStackTo(hasConsole ? STAFF_ROUTES.hub : '/');
}
