import { useSyncExternalStore } from 'react';

/**
 * Does the gym list currently know how far away anything is?
 *
 * Distances are measured server-side from a starting point the app has to
 * supply, and it only has one when the member has pinned a saved address on the
 * map. Without that, every listing comes back with no distance at all — and a
 * "Within 5 km" filter that compares against a missing distance quietly matches
 * every gym, so the member picks a radius, sees the filter light up, and gets
 * the same unfiltered list back. The control looked like it worked and never
 * did.
 *
 * So the directory publishes what it actually got here, and the filter sheet
 * offers the radius chips only while that answer is yes. It is deliberately the
 * loaded LIST that answers, not the request: sending coordinates proves nothing
 * on its own, because a listing with no map position of its own still comes
 * back without a distance.
 *
 * A plain module-level signal rather than a prop: the filter sheet and the
 * directory hook sit on opposite sides of the tab screen, and feature modules
 * never reach into each other for the address that supplies the coordinates.
 */

let distancesKnown = false;
const listeners = new Set<() => void>();

/** Called by the directory hook after every load (cache hits included). */
export function setGymDistancesKnown(next: boolean): void {
  if (next === distancesKnown) return;
  distancesKnown = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return distancesKnown;
}

/**
 * True when the loaded gym list carries real distances, so a radius filter can
 * do something. False before the first load, and whenever the app has no
 * starting point to measure from.
 */
export function useGymDistancesKnown(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
