import { router, type Href } from 'expo-router';

/**
 * Replace the WHOLE root stack with `path`. router.replace alone swaps only
 * the TOP route — after "Welcome → sign-in → replace('/')" the Welcome poster
 * stayed underneath, so the Android back button reopened the front door from
 * the dashboard. Dismissing to the stack root first makes the landing screen
 * the only entry, so back leaves the app instead.
 *
 * Lives in lib/ (not a feature) because every entry-point flow needs it:
 * auth sign-in, onboarding finish and the delete-account exit.
 */
export function resetStackTo(path: string): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(path as Href);
}
