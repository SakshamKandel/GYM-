import { router, type Href } from 'expo-router';
import { getRepo } from '../../lib/repo';

/**
 * Typed-routes escape hatch (same rationale as the training feature's nav):
 * `.expo/types/router.d.ts` only regenerates when the dev server runs, so the
 * /history routes added in this build aren't in the generated union yet.
 */

export function pushHistory(): void {
  router.push('/history' as Href);
}

export function openWorkout(id: string): void {
  router.push(`/history/${id}` as Href);
}

/** Home 'Last session' row → that workout's detail (newest finished session). */
export async function openLastSession(): Promise<void> {
  const repo = await getRepo();
  const last = (await repo.getRecentWorkouts(1))[0];
  if (last) openWorkout(last.id);
  else pushHistory();
}
