import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  fetchMealMenu,
  fetchMealPartners,
  fetchMealSubscriptions,
  fetchMyMealOrders,
  listAddresses,
  quoteMealSubscriptionEdit,
  toMealsError,
  type MealAddress,
  type MealMenuFilters,
  type MealOrder,
  type MealPartner,
  type MealSubscription,
  type MealSubscriptionEditInput,
  type MealSubscriptionPlanQuote,
  type MenuMeal,
} from './api';
import { quoteMealOrder, type MealQuote, type MealQuoteInput } from '../staff/api';

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

/**
 * Live checkout quote (POST /api/meals/quote). Re-fetches on any cart / address
 * / slot change with a short debounce, and reports a `status` the checkout uses
 * to block "Place order" until the shown total is fresh:
 *
 *  - idle    : nothing to quote yet (no token / no partner / empty cart)
 *  - loading : inputs changed, a fresh quote is in flight (the last good quote
 *              may still be shown, but it's stale — placing must be blocked)
 *  - ready   : `quote` matches the current inputs (safe to place)
 *  - error   : the last fetch failed (blocked — the member retries by editing)
 *
 * The server re-prices again at create, so a stale quote can never dictate an
 * amount; this is purely the fee-breakdown preview.
 */
export type MealQuoteStatus = 'idle' | 'loading' | 'ready' | 'error';

const QUOTE_DEBOUNCE_MS = 400;

export function useMealQuote(
  token: string | null,
  input: MealQuoteInput | null,
): { quote: MealQuote | null; status: MealQuoteStatus } {
  const [quote, setQuote] = useState<MealQuote | null>(null);
  const [status, setStatus] = useState<MealQuoteStatus>('idle');
  // Stringified inputs — a stable dependency that only changes when the cart,
  // address, or slot actually change (the object identity changes every render).
  const key = token && input ? JSON.stringify(input) : null;
  // Monotonic request id so a slow in-flight quote can't overwrite a newer one.
  const seqRef = useRef(0);

  useEffect(() => {
    if (!token || !input || !key) {
      seqRef.current += 1;
      setStatus('idle');
      setQuote(null);
      return;
    }
    const seq = ++seqRef.current;
    setStatus('loading');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await quoteMealOrder(input, token);
          if (seqRef.current !== seq) return;
          setQuote(next);
          setStatus('ready');
        } catch {
          if (seqRef.current !== seq) return;
          setStatus('error');
        }
      })();
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, key]);

  return { quote, status };
}

/** Debounced, server-authoritative preview for the recurring-plan edit form. */
export function useMealSubscriptionEditQuote(
  token: string | null,
  subscriptionId: string | null,
  input: MealSubscriptionEditInput | null,
): {
  quote: MealSubscriptionPlanQuote | null;
  status: MealQuoteStatus;
  errorCode: string | null;
} {
  const [quote, setQuote] = useState<MealSubscriptionPlanQuote | null>(null);
  const [status, setStatus] = useState<MealQuoteStatus>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const key = token && subscriptionId && input ? JSON.stringify(input) : null;
  const seqRef = useRef(0);

  useEffect(() => {
    if (!token || !subscriptionId || !input || !key) {
      seqRef.current += 1;
      setStatus('idle');
      setQuote(null);
      setErrorCode(null);
      return;
    }
    const seq = ++seqRef.current;
    setStatus('loading');
    setErrorCode(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await quoteMealSubscriptionEdit(token, subscriptionId, input);
          if (seqRef.current !== seq) return;
          setQuote(next);
          setStatus('ready');
        } catch (error) {
          if (seqRef.current !== seq) return;
          setQuote(null);
          setErrorCode(toMealsError(error).code);
          setStatus('error');
        }
      })();
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, subscriptionId, key]);

  return { quote, status, errorCode };
}
