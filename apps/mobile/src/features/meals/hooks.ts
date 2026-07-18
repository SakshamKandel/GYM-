import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  fetchMealMenu,
  fetchMealPartners,
  fetchMealSubscriptions,
  fetchMyMealOrders,
  listAddresses,
  type MealAddress,
  type MealMenuFilters,
  type MealOrder,
  type MealPartner,
  type MealSubscription,
  type MenuMeal,
} from './api';

/**
 * Load-on-focus hooks for the meals feature, same shape as
 * features/gyms/hooks.ts (last-known state survives a transient failure; a
 * quiet retry covers the rest) — but every fetch here needs a signed-in
 * `token`, so a null token just holds the loading state at rest instead of
 * fetching (the screen renders its own "sign in" gate around that).
 */

interface ListState<T> {
  data: T[] | null;
  loading: boolean;
  error: boolean;
  /** Re-run the fetch (e.g. after a mutation elsewhere on the screen). */
  reload: () => void;
  /** Clear the error flag and retry. */
  retry: () => void;
}

function useLoadOnFocus<T>(token: string | null, fetcher: (token: string) => Promise<T[]>): ListState<T> {
  const [data, setData] = useState<T[] | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    if (!token) return;
    void (async () => {
      try {
        const next = await fetcher(token);
        setData(next);
        setError(false);
      } catch {
        setError(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return { data: token ? data : null, loading: !!token && data === null && !error, error, reload, retry };
}

export function useMealPartners(token: string | null): ListState<MealPartner> {
  return useLoadOnFocus(token, fetchMealPartners);
}

export function useMealMenu(
  token: string | null,
  partnerId: string | null,
  filters?: MealMenuFilters,
): ListState<MenuMeal> {
  const goal = filters?.goal;
  const diet = filters?.diet;
  const date = filters?.date;
  const window = filters?.window;
  return useLoadOnFocus(
    token && partnerId ? token : null,
    useCallback(
      (t: string) => {
        if (!partnerId) return Promise.resolve([]);
        return fetchMealMenu(t, partnerId, { goal, diet, date, window });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [partnerId, goal, diet, date, window],
    ),
  );
}

export function useMyMealOrders(token: string | null, scope: 'upcoming' | 'history'): ListState<MealOrder> {
  return useLoadOnFocus(
    token,
    useCallback((t: string) => fetchMyMealOrders(t, scope), [scope]),
  );
}

export function useMyMealSubscriptions(token: string | null): ListState<MealSubscription> {
  return useLoadOnFocus(token, fetchMealSubscriptions);
}

export function useMealAddresses(token: string | null): ListState<MealAddress> {
  return useLoadOnFocus(token, listAddresses);
}
