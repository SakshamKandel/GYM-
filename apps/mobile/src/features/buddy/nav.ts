import { router, type Href } from 'expo-router';

/**
 * Typed-routes escape hatch (same pattern as features/training/nav.ts).
 * `.expo/types/router.d.ts` only regenerates when the dev server runs, so
 * routes added in this build aren't in the generated union yet. Centralize
 * the cast so it's trivial to delete once the types catch up.
 */
export function pushPath(path: string): void {
  router.push(path as Href);
}
