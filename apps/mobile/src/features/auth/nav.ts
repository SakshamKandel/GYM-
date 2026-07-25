import { router, type Href } from 'expo-router';
import { blurActiveElement } from '../../lib/blurActiveElement';
import { resetStackTo } from '../../lib/nav';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
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
 * A `returnTo` is only followed when it points back INTO this app: an
 * absolute path like '/meals/orders'. Anything carrying a scheme
 * ('https://…', 'gym://…') or a protocol-relative '//host' prefix is dropped,
 * so a crafted link can't use sign-in as a redirect to somewhere else.
 */
function isSafeReturnPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//') || path.startsWith('/\\')) return false;
  return !path.includes('://');
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
 *
 * `returnTo` reopens the screen the member was headed for when sign-in was
 * asked for (e.g. '/meals/orders'). It is pushed AFTER the stack reset, never
 * instead of it, so back still leaves the app rather than reopening Welcome.
 * Staff land in the console, which isn't a member route, so returnTo is
 * skipped there.
 *
 * A brand-new account has no setup yet, and the tabs layout redirects an
 * un-onboarded profile straight back to /welcome — so sending it to '/' bounced
 * the member who had JUST created an account back onto the Welcome poster, which
 * reads as "creating an account threw me out". Such an account goes to
 * /onboarding instead; the tabs gate stays exactly as it is (it's the correct
 * backstop, and onboarding's finish resets to '/' once setup is saved).
 * `onboarded` is safe to read here: every sign-in flow awaits the cloud-profile
 * restore before calling this, so a returning member's restored setup is
 * already in the store and they still land on '/'.
 *
 * A `returnTo` is deliberately dropped for the un-onboarded case — stacking a
 * deep screen on top of an unfinished setup would let the member wander off
 * mid-wizard.
 */
export function enterApp(returnTo?: string): void {
  const { staffRole, staffPermissions } = useAuth.getState();
  const hasConsole = staffRole !== null && staffPermissions.length > 0;
  if (hasConsole) {
    resetStackTo(STAFF_ROUTES.hub);
    return;
  }
  const { onboarded } = useProfile.getState();
  resetStackTo(onboarded ? '/' : '/onboarding');
  if (onboarded && returnTo && isSafeReturnPath(returnTo)) {
    router.push(returnTo as Href);
  }
}
