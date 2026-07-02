import { useEffect, useRef, useState } from 'react';
import type { FoodItem } from '@gym/shared';
import { searchFoods } from '../../lib/api/openFoodFacts';
import { getRepo } from '../../lib/repo';
import { dedupeAgainstLocal } from './logic';

export interface FoodSearchState {
  /** Matches from foods already saved on this device ("My foods"). */
  local: FoodItem[];
  /** Open Food Facts matches (deduped against local). */
  remote: FoodItem[];
  loading: boolean;
  error: boolean;
}

const IDLE: FoodSearchState = { local: [], remote: [], loading: false, error: false };

/** Small debounce so we stay rate-limit friendly with the public API. */
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Dual food search: local repo first, then Open Food Facts.
 * Debounced 350ms; in-flight requests are aborted when the query changes.
 */
export function useFoodSearch(query: string): FoodSearchState {
  const debounced = useDebounced(query.trim(), 350);
  const [state, setState] = useState<FoodSearchState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    if (debounced.length < 2) {
      setState(IDLE);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    setState((s) => ({ ...s, loading: true, error: false }));

    void (async () => {
      let local: FoodItem[] = [];
      try {
        const repo = await getRepo();
        local = await repo.searchLocalFoods(debounced, 10);
      } catch {
        local = [];
      }
      if (!active) return;
      setState((s) => ({ ...s, local }));

      try {
        const remote = await searchFoods(debounced, controller.signal);
        if (!active) return;
        setState({ local, remote: dedupeAgainstLocal(remote, local), loading: false, error: false });
      } catch {
        if (!active || controller.signal.aborted) return;
        setState({ local, remote: [], loading: false, error: true });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [debounced]);

  return state;
}

/** Most recently logged foods — shown while the query is empty. */
export function useRecentFoods(limit: number): { recent: FoodItem[]; loaded: boolean } {
  const [recent, setRecent] = useState<FoodItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void getRepo()
      .then((repo) => repo.getRecentFoods(limit))
      .then((items) => {
        if (active) {
          setRecent(items);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [limit]);

  return { recent, loaded };
}
