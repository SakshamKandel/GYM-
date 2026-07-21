import { router, type Href } from 'expo-router';
import { blurActiveElement } from '../../lib/blurActiveElement';

/**
 * Typed-routes escape hatch (same rationale as features/training/nav.ts):
 * routes added in this build aren't in the generated union until the dev
 * server regenerates `.expo/types/router.d.ts`. Feature modules never import
 * across features, so each keeps its own copy of this two-liner.
 */
export function pushPath(path: string): void {
  blurActiveElement();
  router.push(path as Href);
}
