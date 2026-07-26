'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * View state that lives in the address bar.
 *
 * Every queue in the console kept its tab, its search box and its filters in
 * plain `useState`. That state died the moment an operator opened a record:
 * clearing the payments queue meant picking the Pending tab, typing a name,
 * opening the row, deciding, coming back to an unfiltered list scrolled to the
 * top, and doing all of it again for the next row. Thirty times a morning.
 *
 * Putting the same state in the query string fixes it end to end. The list URL
 * carries the view, so browser Back from a record lands on the list the
 * operator left, and the browser's own scroll restoration for that history
 * entry then puts them back at the row they were on. A filtered view is also
 * something you can send to a colleague.
 *
 * WHY A STORE AND NOT `useSearchParams`
 * We deliberately never re-run the server here. These queues already fetch
 * their own rows (or filter an array they were handed), so a router navigation
 * per keystroke would refetch the page for nothing. Writes go through
 * `history.replaceState`, which updates the address bar and the current history
 * entry without a navigation, and reads come from this tiny store, which also
 * listens for `popstate` so Back and Forward inside the page are followed.
 *
 * `replaceState`, never `pushState`: a filter is not a place. Pushing would
 * make Back walk backwards through every tab click and every letter typed
 * instead of leaving the page.
 *
 * Hydration-safe: the server snapshot is an empty query string, so the markup
 * the server produced always matches the first client render, and the real URL
 * value is applied immediately after hydration.
 */

const listeners = new Set<() => void>();
/** Last query string every subscriber has been told about. */
let announced = '';
let bound = false;

function readSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

/** Re-read the address bar and wake every subscriber if it moved. */
function sync(): void {
  const next = readSearch();
  if (next === announced) return;
  announced = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!bound && typeof window !== 'undefined') {
    bound = true;
    announced = readSearch();
    // Back / Forward land on a history entry whose query string we wrote. One
    // listener for the life of the tab, deliberately never removed: it is
    // shared by every view that uses this store, so tearing it down with the
    // last of them only to add it back with the next costs more than it saves.
    window.addEventListener('popstate', sync);
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Client snapshot. A plain string, so React's own `Object.is` check settles it
 * and there is nothing to cache — and reading the address bar live means a
 * query string changed by something else (a `<Link>`, a redirect) is picked up
 * on the next render rather than going stale.
 */
function getSnapshot(): string {
  return readSearch();
}

function getServerSnapshot(): string {
  return '';
}

/**
 * Write one parameter into the current history entry. `null` removes it, so a
 * view sitting on its defaults has a clean URL rather than a trail of
 * `?tab=open&q=&status=all`.
 */
function writeParam(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (value === null || value === '') params.delete(key);
  else params.set(key, value);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', url);
  sync();
}

/** Current value of one query parameter, or null. Re-renders when it changes. */
export function useUrlParam(key: string): string | null {
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return new URLSearchParams(search).get(key);
}

/**
 * A tab or filter choice, mirrored in the query string.
 *
 * `fallback` is the default view and is never written to the URL, so the plain
 * `/admin/payments` link keeps meaning "the queue as it opens". `allowed`
 * rejects anything else, so a hand-edited or stale URL degrades to the default
 * instead of showing an empty list under a tab that does not exist.
 *
 *   const [tab, setTab] = useUrlState('tab', 'pending', TAB_KEYS);
 */
export function useUrlState<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): [T, (next: T) => void] {
  const raw = useUrlParam(key);

  // Read through a ref so callers can pass an inline array literal without
  // making the setter identity change on every render.
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  const list = allowedRef.current;
  const value: T = raw !== null && (!list || (list as readonly string[]).includes(raw))
    ? (raw as T)
    : fallback;

  const set = useCallback(
    (next: T) => {
      writeParam(key, next === fallback ? null : next);
    },
    [key, fallback],
  );

  return [value, set];
}

/**
 * A search box, mirrored in the query string.
 *
 * Typing stays local so the field never lags a keystroke behind the finger;
 * the URL catches up once typing pauses. Only the pause is recorded, so Back
 * leaves the page rather than replaying the word letter by letter.
 */
export function useUrlSearch(key = 'q', debounceMs = 300): [string, (next: string) => void] {
  const fromUrl = useUrlParam(key) ?? '';
  const [text, setText] = useState(fromUrl);

  // The last value we and the URL agreed on. Anything else in `fromUrl` came
  // from outside (hydration, Back, a link) and should win over local text.
  const settled = useRef(fromUrl);

  useEffect(() => {
    if (fromUrl === settled.current) return;
    settled.current = fromUrl;
    setText(fromUrl);
  }, [fromUrl]);

  useEffect(() => {
    if (text === settled.current) return;
    const timer = setTimeout(() => {
      // Record what the URL will actually read back, not what was typed: a box
      // holding only spaces writes no parameter, so treating it as settled at
      // "   " would have the next read wipe the field under the cursor.
      const next = text.trim() === '' ? '' : text;
      settled.current = next;
      writeParam(key, next === '' ? null : next);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [text, key, debounceMs]);

  return [text, setText];
}
