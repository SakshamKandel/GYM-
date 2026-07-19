import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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
 * Nearby-gyms hooks. Both load on focus and are usable signed OUT (the
 * server routes are public) — no auth-status gating like the mentorship
 * hooks. Last-known state survives transient failures; a quiet retry row
 * covers the rest (features/gyms/api.ts naming mirrors
 * features/mentorship/hooks.ts).
 */

export interface GymDirectoryState {
  /** null until the first successful load. */
  gyms: GymCard[] | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

export function useGymDirectory(coords?: { lat: number; lng: number } | null): GymDirectoryState {
  const [snap, setSnap] = useState<GymCard[] | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    void (async () => {
      try {
        const next = await fetchGyms(coords ? { lat: coords.lat, lng: coords.lng } : undefined);
        setSnap(next);
        setError(false);
      } catch {
        setError(true);
      }
    })();
    // coords is a plain object literal from callers — compare by value to
    // avoid an infinite reload loop from a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const retry = useCallback(() => {
    setError(false);
    reload();
  }, [reload]);

  return { gyms: snap, loading: snap === null && !error, error, retry };
}

export interface GymDetailState {
  gym: GymDetail | null;
  loading: boolean;
  notFound: boolean;
  error: boolean;
  retry: () => void;
}

export function useGymDetail(slug: string): GymDetailState {
  const [gym, setGym] = useState<GymDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    if (!slug) return;
    void (async () => {
      try {
        const next = await fetchGymDetail(slug);
        setGym(next);
        setNotFound(false);
        setError(false);
      } catch (err) {
        if (toGymsError(err).code === 'not_found') setNotFound(true);
        else setError(true);
      }
    })();
  }, [slug]);

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

/** GET /api/gyms/favorites (Pack M — powers /gyms/saved). Member-only; pass
 * `null` when signed out (returns an empty, non-loading state). */
export function useFavoriteGyms(token: string | null): FavoriteGymsState {
  const [snap, setSnap] = useState<FavoriteGymCard[] | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    if (!token) {
      setSnap([]);
      return;
    }
    void (async () => {
      try {
        const next = await fetchFavoriteGyms(token);
        setSnap(next);
        setError(false);
      } catch {
        setError(true);
      }
    })();
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const retry = useCallback(() => {
    setError(false);
    reload();
  }, [reload]);

  return { gyms: snap, loading: snap === null && !error, error, retry };
}
