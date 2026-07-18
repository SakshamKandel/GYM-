'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a STABLE function identity that always invokes the latest version of
 * `fn`. Lets an effect depend on a handler (e.g. a poller) without re-running —
 * and thus without tearing down / recreating its interval — every render, while
 * the handler still closes over fresh state. A tiny local utility so the partner
 * board needn't pull in an external hooks dependency.
 */
export function useCallbackRef<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
