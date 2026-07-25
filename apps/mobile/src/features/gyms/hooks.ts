import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadResource, peekResource, STALE_DIRECTORY_MS } from '../../lib/resourceCache';
import {
  useSessionScopedResource,
  watchSessionForResourceCache,
} from '../../lib/useSessionScopedResource';
import { useAuth } from '../../state/auth';
import { setGymDistancesKnown } from './location';
import {
  fetchFavoriteGyms,
  fetchGymDetail,
  fetchGymReviews,
  fetchGyms,
  toGymsError,
  type FavoriteGymCard,
  type GymCard,
  type GymDetail,
  type GymReview,
} from './api';

/**
 * Nearby-gyms hooks. The directory, detail and review hooks load on focus and
 * are usable signed OUT (the server routes are public) — no auth-status gating
 * like the mentorship hooks, and deliberately NOT account-scoped, because
 * scoping them to a token would empty them for signed-out browsing.
 * useFavoriteGyms is the exception: it's member-only, so it runs on the shared
 * session-scoped loader (lib/useSessionScopedResource) and a response from a
 * previous account can never land after a switch. Last-known state survives
 * transient failures; a quiet retry row covers the rest (features/gyms/api.ts
 * naming mirrors features/mentorship/hooks.ts).
 *
 * Two details that are easy to get wrong here:
 *  - useGymDetail takes an OPTIONAL token. The response's saved (heart) flag
 *    only comes back for a request that carries the session, so a signed-in
 *    screen must pass it; signed out it stays a plain public read.
 *  - Anything these hooks keep in the shared cache is still stamped with the
 *    current session token, so nothing survives a sign-out or an account
 *    switch even though the data itself is public.
 */

export interface GymDirectoryState {
  /** null until the first successful load. */
  gyms: GymCard[] | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

/**
 * Tell the filter sheet whether this list can be filtered by distance at all.
 * Read from the rows themselves, not from the request: coordinates were only
 * useful if the server could measure something with them (features/gyms/
 * location.ts).
 */
function publishDistances(gyms: GymCard[]): void {
  setGymDistancesKnown(gyms.some((gym) => gym.distanceKm !== null));
}

/**
 * The gym directory. The Gyms tab asks for it twice on every focus — once
 * straight away, then again with coordinates as soon as the member's saved
 * address lands — so the two answers race: without an ordering guard the
 * first (list with no distances) could arrive last and win, leaving the tab
 * showing an unsorted list next to a "nearest first" promise. A monotonic
 * sequence fixes that: only the newest load may write state, and every load
 * bumps it, retries and cache hits included.
 *
 * Listings barely move, so a directory fetched a few minutes ago is served
 * straight from the shared cache instead of hitting the network on every
 * focus. Distances live in the key (the coordinates are part of it) and the
 * cache is scoped to the current session like everything else.
 *
 * Every load also publishes whether the list came back with distances at all,
 * which is what lets the filter sheet offer a radius only when a radius can
 * mean something (features/gyms/location.ts).
 */
export function useGymDirectory(coords?: { lat: number; lng: number } | null): GymDirectoryState {
  // This hook can be the only thing on screen putting anything in the shared
  // cache, so it installs the sign-out wipe too (idempotent).
  watchSessionForResourceCache();
  const sessionToken = useAuth((s) => s.token);
  const [snap, setSnap] = useState<GymCard[] | null>(null);
  const [error, setError] = useState(false);
  const requestSequence = useRef(0);
  // coords is a plain object literal from callers — read it as two values so
  // a fresh object every render can't restart the load in a loop.
  const lat = coords?.lat ?? null;
  const lng = coords?.lng ?? null;
  const cacheKey = `gyms:directory:${lat ?? ''}:${lng ?? ''}`;

  const load = useCallback(
    (force: boolean) => {
      const sequence = ++requestSequence.current;
      if (!force) {
        const cached = peekResource<GymCard[]>(cacheKey, sessionToken, STALE_DIRECTORY_MS);
        if (cached) {
          setSnap((prev) => (prev === cached.data ? prev : cached.data));
          setError(false);
          publishDistances(cached.data);
          return;
        }
      }
      void (async () => {
        try {
          const next = await loadResource(
            cacheKey,
            sessionToken,
            () => fetchGyms(lat !== null && lng !== null ? { lat, lng } : undefined),
            { staleMs: STALE_DIRECTORY_MS, force },
          );
          if (sequence !== requestSequence.current) return;
          setSnap(next);
          setError(false);
          publishDistances(next);
        } catch {
          if (sequence !== requestSequence.current) return;
          setError(true);
        }
      })();
    },
    [cacheKey, lat, lng, sessionToken],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  const retry = useCallback(() => {
    setError(false);
    load(true);
  }, [load]);

  return { gyms: snap, loading: snap === null && !error, error, retry };
}

export interface GymDetailState {
  gym: GymDetail | null;
  loading: boolean;
  notFound: boolean;
  error: boolean;
  retry: () => void;
}

/**
 * One gym's detail. Pass the member's `token` while signed in: the saved
 * (heart) flag comes back on this response and the server can only fill it in
 * for a request that carries the session, so without it the screen always read
 * "not saved". Signed out, pass nothing — the listing is public either way, and
 * a session the server rejects falls back to the public read rather than
 * failing the screen (see fetchGymDetail).
 */
export function useGymDetail(slug: string, token?: string | null): GymDetailState {
  const [gym, setGym] = useState<GymDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  // Signing in mid-screen re-runs this with a token; only the newest load may
  // write state, so the older tokenless answer can't overwrite the saved flag.
  const requestSequence = useRef(0);

  const reload = useCallback(() => {
    if (!slug) return;
    const sequence = ++requestSequence.current;
    void (async () => {
      try {
        const next = await fetchGymDetail(slug, token ?? null);
        if (sequence !== requestSequence.current) return;
        setGym(next);
        setNotFound(false);
        setError(false);
      } catch (err) {
        if (sequence !== requestSequence.current) return;
        if (toGymsError(err).code === 'not_found') setNotFound(true);
        else setError(true);
      }
    })();
  }, [slug, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const retry = useCallback(() => {
    setError(false);
    reload();
  }, [reload]);

  return { gym, loading: gym === null && !notFound && !error, notFound, error, retry };
}

export interface GymReviewsState {
  reviews: GymReview[];
  loading: boolean;
  error: boolean;
  /** Re-fetch on demand (e.g. right after the caller submits their own
   * review) — independent of focus, unlike the other hooks here. */
  refresh: () => void;
}

/** GET /api/gyms/[slug]/reviews (Pack C — powers GymReviewsSection). Loads on
 * focus AND exposes an imperative `refresh` for the post-submit re-fetch. */
export function useGymReviews(slug: string): GymReviewsState {
  const [reviews, setReviews] = useState<GymReview[] | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    if (!slug) return;
    void (async () => {
      try {
        const next = await fetchGymReviews(slug);
        setReviews(next);
        setError(false);
      } catch {
        setError(true);
      }
    })();
  }, [slug]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { reviews: reviews ?? [], loading: reviews === null && !error, error, refresh: reload };
}

export interface FavoriteGymsState {
  gyms: FavoriteGymCard[] | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

/** Stable empty list for the signed-out state (a fresh `[]` every render would
 * churn any consumer that watches `gyms` by identity). */
const NO_FAVORITES: FavoriteGymCard[] = [];

/** GET /api/gyms/favorites (Pack M — powers /gyms/saved). Member-only, so it
 * rides the shared session-scoped loader: the list is stamped with the token
 * that loaded it and re-derived against the current one, so switching accounts
 * shows the new member's shortlist (empty while it loads) instead of the
 * previous member's. Pass `null` when signed out (an empty, non-loading
 * state). */
export function useFavoriteGyms(token: string | null): FavoriteGymsState {
  const { data, loading, error, retry } = useSessionScopedResource(token, fetchFavoriteGyms);
  return { gyms: token === null ? NO_FAVORITES : data, loading, error, retry };
}
