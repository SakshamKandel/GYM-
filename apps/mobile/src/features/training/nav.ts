import { router, type Href } from 'expo-router';
import { blurActiveElement } from '../../lib/blurActiveElement';

/**
 * Typed-routes escape hatch. `.expo/types/router.d.ts` only regenerates when
 * the dev server runs, so routes added in this build (workout/*, exercises/*)
 * aren't in the generated union yet. Centralize the cast here so screens stay
 * clean and the cast is trivial to delete once the types catch up.
 */
export function pushPath(path: string): void {
  blurActiveElement();
  router.push(path as Href);
}

export function replacePath(path: string): void {
  blurActiveElement();
  router.replace(path as Href);
}
