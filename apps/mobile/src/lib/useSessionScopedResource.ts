import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { clearResourceCache, loadResource, peekResource } from './resourceCache';
import { isCurrentSessionRequest } from './sessionRequest';
import { useAuth } from '../state/auth';

/**
 * Load-on-focus list loader for account-bound data, scoped to the session that
 * asked for it. Lifted out of features/meals/hooks.ts so the gyms feature (and
 * anything else) can reuse it without importing another feature module.
 *
 * The rule it enforces: after an account switch, a response that started under
 * the PREVIOUS account must never land in the new account's UI. Three parts,
 * all required:
 *  1. snapshot the token when the request starts,
 *  2. bump a monotonic sequence so an older request for the same session loses
 *     to a newer one,
 *  3. re-check both on success AND on failure before touching state — a late
 *     rejection would otherwise flag an error against the wrong account.
 *
 * State is stored stamped with the token it belongs to and derived against the
 * CURRENT token at render, so the instant the token changes the hook reports an
 * empty, loading state instead of the previous account's rows — no effect has
 * to run first.
 *
 * Every fetch here needs a signed-in `token`; a null token just holds the state
 * at rest instead of fetching (screens render their own "sign in" gate).
 *
 * Pass a `key` (and optionally `staleMs`) to back the hook with the shared
 * lib/resourceCache: identical requests in flight at once become one, and a
 * value younger than `staleMs` is served straight from memory instead of
 * refetching on every focus. Without a key the hook fetches every time, exactly
 * as it always has.
 */

let sessionWatcherInstalled = false;
let lastKnownAuthToken: string | null = null;

/**
 * Wipe the shared cache whenever the session token changes. Rule 2 of
 * lib/resourceCache: signing out (or switching accounts) must not leave the
 * previous account's rows in memory, and this fires the moment the token
 * changes rather than waiting for a screen to ask for something.
 *
 * Installed on first use rather than at import time — state/auth pulls in a
 * long tail of modules, and reaching into the store while those are still
 * evaluating is how import cycles turn into a blank app. Idempotent, and the
 * cache clears itself anyway the first time it is read under a new session.
 */
export function watchSessionForResourceCache(): void {
  if (sessionWatcherInstalled) return;
  sessionWatcherInstalled = true;
  lastKnownAuthToken = useAuth.getState().token;
  useAuth.subscribe((state) => {
    if (state.token === lastKnownAuthToken) return;
    lastKnownAuthToken = state.token;
    clearResourceCache();
  });
}

export interface SessionScopedListState<T> {
  /** null until the first successful load for the CURRENT token. */
  data: T[] | null;
  loading: boolean;
  error: boolean;
  /** Re-run the fetch (e.g. after a mutation elsewhere on the screen). */
  reload: () => void;
  /** Clear the error flag and retry. */
  retry: () => void;
}

/** Last successful load, stamped with the token that produced it. */
export interface SessionScopedSnapshot<T> {
  token: string;
  data: T[];
}

/** The render-time slice of {@link SessionScopedListState} (no callbacks). */
export interface SessionScopedView<T> {
  data: T[] | null;
  loading: boolean;
  error: boolean;
}

export interface SessionScopedResourceOptions {
  /**
   * Shared-cache key. It MUST include every parameter that changes the
   * response (partner id, filters, scope) — two different lists under one key
   * would serve each other's rows. Omit it to opt out of the cache entirely.
   */
  key?: string;
  /**
   * How long a cached value may be reused without a request. Defaults to 0:
   * always refetch, which is what order and payment data must keep doing.
   */
  staleMs?: number;
}

/**
 * Pure render-time projection — exported separately so the account-scoping rule
 * is testable without React. Anything loaded (or failed) under a different
 * token reads as "nothing yet, still loading" for the current one.
 */
export function selectSessionScopedState<T>(
  token: string | null,
  snapshot: SessionScopedSnapshot<T> | null,
  errorToken: string | null,
): SessionScopedView<T> {
  const data = token !== null && snapshot?.token === token ? snapshot.data : null;
  const error = token !== null && errorToken === token;
  return { data, loading: token !== null && data === null && !error, error };
}

export function useSessionScopedResource<T>(
  token: string | null,
  fetcher: (token: string) => Promise<T[]>,
  options?: SessionScopedResourceOptions,
): SessionScopedListState<T> {
  watchSessionForResourceCache();
  const [snapshot, setSnapshot] = useState<SessionScopedSnapshot<T> | null>(null);
  const [errorToken, setErrorToken] = useState<string | null>(null);
  const requestSequence = useRef(0);
  // Read as primitives: the caller passes a fresh options object every render.
  const cacheKey = options?.key ?? null;
  const staleMs = options?.staleMs ?? 0;

  const load = useCallback(
    (force: boolean) => {
      if (!token) return;
      // The sequence is bumped for EVERY load, cache hit included: a hit that
      // resolved the resource must also beat a request still in flight from
      // before it, or the older response would land on top.
      const request = { token, sequence: ++requestSequence.current };

      if (cacheKey !== null && !force) {
        const cached = peekResource<T[]>(cacheKey, token, staleMs);
        if (cached) {
          // Keep the identity stable when nothing actually changed, so screens
          // that watch `data` by reference don't re-run on every focus.
          setSnapshot((prev) =>
            prev !== null && prev.token === token && prev.data === cached.data
              ? prev
              : { token, data: cached.data },
          );
          setErrorToken(null);
          return;
        }
      }

      void (async () => {
        try {
          const next =
            cacheKey === null
              ? await fetcher(token)
              : await loadResource(cacheKey, token, () => fetcher(token), { staleMs, force });
          if (
            !isCurrentSessionRequest(request, {
              token: useAuth.getState().token,
              sequence: requestSequence.current,
            })
          ) return;
          setSnapshot({ token, data: next });
          setErrorToken(null);
        } catch {
          if (
            !isCurrentSessionRequest(request, {
              token: useAuth.getState().token,
              sequence: requestSequence.current,
            })
          ) return;
          setErrorToken(token);
        }
      })();
    },
    [cacheKey, fetcher, staleMs, token],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  // An explicit reload always goes to the network: it follows a mutation or a
  // pull to refresh, where reusing a cached (or already in-flight) list would
  // hand back the state the caller is trying to move past.
  const reload = useCallback(() => {
    load(true);
  }, [load]);

  const retry = useCallback(() => {
    setErrorToken(null);
    load(true);
  }, [load]);

  const { data, loading, error } = selectSessionScopedState(token, snapshot, errorToken);
  return { data, loading, error, reload, retry };
}
