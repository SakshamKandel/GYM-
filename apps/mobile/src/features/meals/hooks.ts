import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { isCurrentSessionRequest } from '../../lib/sessionRequest';
import { useAuth } from '../../state/auth';
import {
  fetchMealMenu,
  fetchMealPartners,
  fetchMealQuote,
  fetchMealSubscriptions,
  fetchMyMealOrders,
  listAddresses,
  quoteMealSubscriptionEdit,
  toMealsError,
  type MealAddress,
  type MealMenuFilters,
  type MealOrder,
  type MealPartner,
  type MealQuote,
  type MealQuoteInput,
  type MealSubscription,
  type MealSubscriptionEditInput,
  type MealSubscriptionPlanQuote,
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
  const [snapshot, setSnapshot] = useState<{ token: string; data: T[] } | null>(null);
  const [errorToken, setErrorToken] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(() => {
    if (!token) return;
    const request = { token, sequence: ++requestSequence.current };
    void (async () => {
      try {
        const next = await fetcher(token);
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
  }, [fetcher, token]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const retry = useCallback(() => {
    setErrorToken(null);
    reload();
  }, [reload]);

  const data = token !== null && snapshot?.token === token ? snapshot.data : null;
  const error = token !== null && errorToken === token;
  return { data, loading: token !== null && data === null && !error, error, reload, retry };
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
): {
  quote: MealQuote | null;
  status: MealQuoteStatus;
  /** The failed quote's error code (e.g. `meal_unavailable`), when `status`
   * is `'error'` — lets the checkout surface B11's per-line copy instead of a
   * generic message. */
  errorCode: string | null;
  /** The failed quote's error body, minus `error` (e.g. `{mealId,mealName}`
   * on `meal_unavailable`). */
  errorDetails: Record<string, unknown> | null;
} {
  const [quote, setQuote] = useState<MealQuote | null>(null);
  const [status, setStatus] = useState<MealQuoteStatus>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Record<string, unknown> | null>(null);
  // Stringified inputs — a stable dependency that only changes when the cart,
  // address, or slot actually change (the object identity changes every render).
  const key = token && input ? JSON.stringify(input) : null;
  const scope = token && key ? `${token}\u0000${key}` : null;
  const [stateScope, setStateScope] = useState<string | null>(null);
  // Monotonic request id so a slow in-flight quote can't overwrite a newer one.
  const seqRef = useRef(0);

  useEffect(() => {
    if (!token || !input || !key) {
      seqRef.current += 1;
      setStateScope(null);
      setStatus('idle');
      setQuote(null);
      setErrorCode(null);
      setErrorDetails(null);
      return;
    }
    const request = { token, sequence: ++seqRef.current };
    setStateScope(scope);
    setStatus('loading');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await fetchMealQuote(token, input);
          if (!isCurrentSessionRequest(request, { token: useAuth.getState().token, sequence: seqRef.current })) return;
          setQuote(next);
          setStatus('ready');
          setErrorCode(null);
          setErrorDetails(null);
        } catch (err) {
          if (!isCurrentSessionRequest(request, { token: useAuth.getState().token, sequence: seqRef.current })) return;
          const apiErr = toMealsError(err);
          setStatus('error');
          setErrorCode(apiErr.code);
          setErrorDetails(apiErr.details ?? null);
        }
      })();
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, key, scope]);

  if (stateScope !== scope) {
    return {
      quote: null,
      status: scope === null ? 'idle' : 'loading',
      errorCode: null,
      errorDetails: null,
    };
  }
  return { quote, status, errorCode, errorDetails };
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
  const scope = token && subscriptionId && key ? `${token}\u0000${subscriptionId}\u0000${key}` : null;
  const [stateScope, setStateScope] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!token || !subscriptionId || !input || !key) {
      seqRef.current += 1;
      setStateScope(null);
      setStatus('idle');
      setQuote(null);
      setErrorCode(null);
      return;
    }
    const request = { token, sequence: ++seqRef.current };
    setStateScope(scope);
    setStatus('loading');
    setErrorCode(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await quoteMealSubscriptionEdit(token, subscriptionId, input);
          if (!isCurrentSessionRequest(request, { token: useAuth.getState().token, sequence: seqRef.current })) return;
          setQuote(next);
          setStatus('ready');
        } catch (error) {
          if (!isCurrentSessionRequest(request, { token: useAuth.getState().token, sequence: seqRef.current })) return;
          setQuote(null);
          setErrorCode(toMealsError(error).code);
          setStatus('error');
        }
      })();
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, subscriptionId, key, scope]);

  if (stateScope !== scope) {
    return { quote: null, status: scope === null ? 'idle' : 'loading', errorCode: null };
  }
  return { quote, status, errorCode };
}
