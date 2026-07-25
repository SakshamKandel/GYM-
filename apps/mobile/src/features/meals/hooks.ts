import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STALE_ALWAYS_REFETCH,
  STALE_CATALOG_MS,
  STALE_DIRECTORY_MS,
} from '../../lib/resourceCache';
import { isCurrentSessionRequest } from '../../lib/sessionRequest';
import {
  useSessionScopedResource,
  type SessionScopedListState,
} from '../../lib/useSessionScopedResource';
import { useAuth } from '../../state/auth';
import {
  fetchMealMenu,
  fetchMealPartners,
  fetchMealQuote,
  fetchMealSubscriptions,
  fetchMyMealOrderPage,
  fetchMyMealOrders,
  listAddresses,
  quoteMealPlan,
  quoteMealSubscriptionEdit,
  toMealsError,
  type MealAddress,
  type MealMenuFilters,
  type MealOrder,
  type MealPartner,
  type MealPlanQuoteInput,
  type MealQuote,
  type MealQuoteInput,
  type MealSubscription,
  type MealSubscriptionEditInput,
  type MealSubscriptionPlanQuote,
  type MenuMeal,
} from './api';

/**
 * Load-on-focus hooks for the meals feature. The account-scoped loader itself
 * now lives in lib/useSessionScopedResource (features can't import each other,
 * and the gyms feature needs the same guarantee) — last-known state survives a
 * transient failure, a quiet retry covers the rest, and a response from a
 * previous account can never land in the new one. Every fetch here needs a
 * signed-in `token`, so a null token just holds the loading state at rest
 * instead of fetching (the screen renders its own "sign in" gate around that).
 *
 * Caching, via the shared keys below: read-mostly lists (the partner directory,
 * a partner's menu) may be served from memory for a few minutes instead of
 * refetching every single time a screen regains focus. Anything the member is
 * watching change — orders, subscriptions, addresses — keeps refetching on
 * every focus and only shares requests that are already in flight together.
 */

export type ListState<T> = SessionScopedListState<T>;

export function useMealPartners(token: string | null): ListState<MealPartner> {
  return useSessionScopedResource(token, fetchMealPartners, {
    key: 'meals:partners',
    staleMs: STALE_DIRECTORY_MS,
  });
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
  return useSessionScopedResource(
    token && partnerId ? token : null,
    useCallback(
      (t: string) => {
        if (!partnerId) return Promise.resolve([]);
        return fetchMealMenu(t, partnerId, { goal, diet, date, window });
      },
      [partnerId, goal, diet, date, window],
    ),
    // Every filter is part of the key — one partner's breakfast menu must
    // never be served for another's dinner. (The loader reads `key`/`staleMs`
    // as plain values, so a fresh object each render costs nothing.)
    partnerId
      ? {
          key: `meals:menu:${partnerId}:${goal ?? ''}:${diet ?? ''}:${date ?? ''}:${window ?? ''}`,
          staleMs: STALE_CATALOG_MS,
        }
      : undefined,
  );
}

export function useMyMealOrders(token: string | null, scope: 'upcoming' | 'history'): ListState<MealOrder> {
  return useSessionScopedResource(
    token,
    useCallback((t: string) => fetchMyMealOrders(t, scope), [scope]),
    // Orders are never served from memory; the key only lets two screens
    // asking at the same moment share one request.
    { key: `meals:orders:${scope}`, staleMs: STALE_ALWAYS_REFETCH },
  );
}

/** How many past orders one page of history carries. */
const HISTORY_PAGE_SIZE = 25;

export interface MealOrderHistoryState extends ListState<MealOrder> {
  /** The server has at least one more page of past orders. */
  hasMore: boolean;
  loadingMore: boolean;
  /** The last "show older" attempt failed — the UI offers a retry. */
  moreError: boolean;
  loadMore: () => void;
}

interface HistoryPages {
  token: string;
  orders: MealOrder[];
  nextOffset: number | null;
}

/**
 * The member's past orders, PAGED. The list used to render whatever the first
 * response happened to contain and then just stop — a member with a long
 * history simply couldn't reach their older orders (or the receipts and
 * disputes hanging off them). This keeps the account-scoping guarantees of
 * `useSessionScopedResource` for the first page and appends further pages via
 * the server's `nextOffset` cursor.
 */
export function useMealOrderHistory(token: string | null): MealOrderHistoryState {
  const [pages, setPages] = useState<HistoryPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  // One sequence per concern: a first-page reload invalidates any in-flight
  // "show older" fetch, and an older first-page response can never overwrite a
  // newer one (the same rule useSessionScopedResource applies to its snapshot).
  const firstSeqRef = useRef(0);
  const moreSeqRef = useRef(0);

  const fetchFirstPage = useCallback(async (t: string): Promise<MealOrder[]> => {
    const sequence = ++firstSeqRef.current;
    const page = await fetchMyMealOrderPage(t, 'history', { limit: HISTORY_PAGE_SIZE, offset: 0 });
    if (sequence !== firstSeqRef.current) return page.orders;
    // Any pending "show older" belongs to the list we just replaced.
    moreSeqRef.current += 1;
    setPages({ token: t, orders: page.orders, nextOffset: page.nextOffset });
    setLoadingMore(false);
    setMoreError(false);
    return page.orders;
  }, []);

  // Deliberately NOT given a shared-cache key: `fetchFirstPage` also writes
  // this hook instance's paging state, so it must run for every load rather
  // than being shared with (or skipped for) another instance.
  const base = useSessionScopedResource(token, fetchFirstPage);
  // Anything loaded under a different account reads as "nothing yet" — same
  // rule the base resource applies to its own snapshot.
  const scoped = token !== null && pages?.token === token ? pages : null;

  const loadMore = useCallback(() => {
    if (!token || loadingMore) return;
    const current = pages;
    if (!current || current.token !== token || current.nextOffset === null) return;
    const offset = current.nextOffset;
    const request = { token, sequence: ++moreSeqRef.current };
    setLoadingMore(true);
    setMoreError(false);
    void (async () => {
      try {
        const page = await fetchMyMealOrderPage(token, 'history', {
          limit: HISTORY_PAGE_SIZE,
          offset,
        });
        if (!isCurrentSessionRequest(request, { token: useAuth.getState().token, sequence: moreSeqRef.current })) {
          return;
        }
        setPages((prev) => {
          // The list was reloaded (or paged again) underneath this response.
          if (!prev || prev.token !== token || prev.nextOffset !== offset) return prev;
          // Newer orders can shift an offset-paged window, so a row already on
          // screen must never be appended twice.
          const seen = new Set(prev.orders.map((o) => o.id));
          return {
            token,
            orders: [...prev.orders, ...page.orders.filter((o) => !seen.has(o.id))],
            nextOffset: page.nextOffset,
          };
        });
        setLoadingMore(false);
      } catch {
        if (!isCurrentSessionRequest(request, { token: useAuth.getState().token, sequence: moreSeqRef.current })) {
          return;
        }
        // Keep the pages already on screen; the row turns into a retry.
        setMoreError(true);
        setLoadingMore(false);
      }
    })();
  }, [token, loadingMore, pages]);

  return {
    ...base,
    data: base.data === null ? null : (scoped?.orders ?? base.data),
    hasMore: scoped?.nextOffset != null,
    loadingMore,
    moreError,
    loadMore,
  };
}

export function useMyMealSubscriptions(token: string | null): ListState<MealSubscription> {
  return useSessionScopedResource(token, fetchMealSubscriptions, {
    key: 'meals:subscriptions',
    staleMs: STALE_ALWAYS_REFETCH,
  });
}

/**
 * Saved delivery addresses. Shared by checkout, the plan editor and both gym
 * screens (which use the default address as a "home base" for distance), so the
 * dedupe matters — but the member edits this list themselves, so it is never
 * served from memory: every focus refetches, and every screen that changes an
 * address already calls `reload`, which always goes to the network.
 */
export function useMealAddresses(token: string | null): ListState<MealAddress> {
  return useSessionScopedResource(token, listAddresses, {
    key: 'meals:addresses',
    staleMs: STALE_ALWAYS_REFETCH,
  });
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

/**
 * Debounced, server-authoritative price preview for a weekly plan the member
 * hasn't created yet (POST /api/meals/plan-quote). Signup used to show no
 * price at all — the first time anyone saw what a plan cost was after they had
 * already started it. Same `status` contract as {@link useMealQuote}: only
 * `'ready'` means the shown per-day price matches the plan on screen.
 */
export function useMealPlanQuote(
  token: string | null,
  input: MealPlanQuoteInput | null,
): {
  quote: MealSubscriptionPlanQuote | null;
  status: MealQuoteStatus;
  errorCode: string | null;
} {
  const [quote, setQuote] = useState<MealSubscriptionPlanQuote | null>(null);
  const [status, setStatus] = useState<MealQuoteStatus>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const key = token && input ? JSON.stringify(input) : null;
  const scope = token && key ? `${token}|${key}` : null;
  const [stateScope, setStateScope] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!token || !input || !key) {
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
          const next = await quoteMealPlan(token, input);
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
  }, [token, key, scope]);

  if (stateScope !== scope) {
    return { quote: null, status: scope === null ? 'idle' : 'loading', errorCode: null };
  }
  return { quote, status, errorCode };
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
