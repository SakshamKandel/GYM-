/**
 * Shared in-memory resource cache for read paths (request dedupe + a
 * configurable staleness window).
 *
 * Every screen used to refetch its lists from scratch on every focus: walking
 * Meals → a partner → back re-ran the same partner request three times, and two
 * components wanting the same list on one screen made two identical requests.
 * lib/trainingCatalog.ts already solved this for one module (in-flight dedupe +
 * serve-then-revalidate); this is that machinery generalised so any resource can
 * opt in with a key and a window.
 *
 * ACCOUNT ISOLATION — the rules this module must never break:
 *  1. Every stored value is stamped with the session token it was fetched
 *     under, and a read only ever returns a value stamped with the SAME token.
 *     A different account (or a signed-out reader) misses, it never reads
 *     someone else's row.
 *  2. The whole store is wiped the moment the session token changes, so signing
 *     out (or switching accounts) leaves nothing of the previous account in
 *     memory. Two independent triggers do this: the auth subscription in
 *     lib/useSessionScopedResource.ts, and `enterSession` below, which notices a
 *     token it has not seen on the very next read or write.
 *  3. A response that started under the previous session is dropped instead of
 *     stored (the generation counter), so a request in flight across a sign-out
 *     cannot repopulate the store afterwards.
 *
 * The `sessionToken` passed to every call is ALWAYS the current auth token
 * (null when signed out) — including for public resources like the gym
 * directory, which are unauthenticated on the wire but still scoped here so
 * rule 1 holds for everything without exception.
 *
 * No React, no auth, no network imports: this file is pure state so its rules
 * stay easy to reason about (and testable on their own).
 */

/** A stored value plus the session it belongs to. */
interface StoredEntry {
  sessionToken: string | null;
  data: unknown;
  fetchedAt: number;
}

interface InFlightRequest {
  sessionToken: string | null;
  sequence: number;
  promise: Promise<unknown>;
}

/** Read-mostly directories (meal partners, gym listings). */
export const STALE_DIRECTORY_MS = 5 * 60_000;

/** Catalogs that can move during the day (a partner's menu). */
export const STALE_CATALOG_MS = 2 * 60_000;

/**
 * Orders, payments, addresses, anything the member is watching change: never
 * served from memory, always refetched. Such resources still get in-flight
 * dedupe, and nothing about them is kept in the store.
 */
export const STALE_ALWAYS_REFETCH = 0;

/** Upper bound on stored resources; the oldest is dropped past this. */
const MAX_ENTRIES = 64;

const entries = new Map<string, StoredEntry>();
const inFlight = new Map<string, InFlightRequest>();
/** Newest request per key, tracked separately so it can be set synchronously. */
const latestSequence = new Map<string, number>();

let sessionKnown = false;
let sessionToken: string | null = null;
let sequenceCounter = 0;
/** Bumped by every wipe; a response from an older generation is not stored. */
let generation = 0;

/** Drop everything. Called on any session change, from both triggers above. */
export function clearResourceCache(): void {
  entries.clear();
  inFlight.clear();
  latestSequence.clear();
  generation += 1;
  sessionKnown = false;
  sessionToken = null;
}

/** Notice a session change on the read/write path and wipe before serving. */
function enterSession(token: string | null): void {
  if (sessionKnown && sessionToken === token) return;
  if (sessionKnown) clearResourceCache();
  sessionKnown = true;
  sessionToken = token;
}

function evictOldestIfFull(): void {
  if (entries.size <= MAX_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, entry] of entries) {
    if (entry.fetchedAt < oldestAt) {
      oldestAt = entry.fetchedAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) entries.delete(oldestKey);
}

/** A cache hit. Wrapped so a stored value of `null` stays representable. */
export interface CachedResource<T> {
  data: T;
}

/**
 * The stored value for `key`, but only when it belongs to this session AND is
 * younger than `staleMs`. `staleMs` of 0 always misses. Reading is synchronous
 * so a screen can paint cached rows without a loading frame first.
 */
export function peekResource<T>(
  key: string,
  token: string | null,
  staleMs: number,
): CachedResource<T> | null {
  enterSession(token);
  if (staleMs <= 0) return null;
  const entry = entries.get(key);
  if (!entry || entry.sessionToken !== token) return null;
  const age = Date.now() - entry.fetchedAt;
  // A device clock moved backwards reads as stale rather than fresh forever.
  if (age < 0 || age > staleMs) return null;
  return { data: entry.data as T };
}

export interface LoadResourceOptions {
  /** How long a stored value may be reused without a request. 0 = never. */
  staleMs: number;
  /**
   * Skip the stored value AND any request already in flight, and start a fresh
   * one. Used by explicit reloads (pull to refresh, retry, after a mutation):
   * joining a request that started BEFORE the mutation would hand back the
   * pre-mutation list.
   */
  force?: boolean;
}

/**
 * Resolve `key` for this session: a fresh stored value, else the request
 * already in flight for it, else a new one from `fetcher`.
 *
 * `fetcher` takes no arguments — the caller closes over its own token, so this
 * module stays unaware of how anything is fetched.
 */
export function loadResource<T>(
  key: string,
  token: string | null,
  fetcher: () => Promise<T>,
  options: LoadResourceOptions,
): Promise<T> {
  enterSession(token);

  if (options.force !== true) {
    const cached = peekResource<T>(key, token, options.staleMs);
    if (cached) return Promise.resolve(cached.data);
    const pending = inFlight.get(key);
    if (pending && pending.sessionToken === token) return pending.promise as Promise<T>;
  }

  const requestGeneration = generation;
  const requestSequence = ++sequenceCounter;
  latestSequence.set(key, requestSequence);

  const promise = (async (): Promise<T> => {
    try {
      const data = await fetcher();
      const newest = latestSequence.get(key) === requestSequence;
      // Storing is skipped when: a newer request for the same key has already
      // started (it wins), the session changed underneath (rule 3), or the
      // resource opted out of being kept at all.
      if (newest && requestGeneration === generation && options.staleMs > 0) {
        entries.set(key, { sessionToken: token, data, fetchedAt: Date.now() });
        evictOldestIfFull();
      }
      return data;
    } finally {
      if (inFlight.get(key)?.sequence === requestSequence) inFlight.delete(key);
    }
  })();

  inFlight.set(key, { sessionToken: token, sequence: requestSequence, promise });
  return promise;
}
