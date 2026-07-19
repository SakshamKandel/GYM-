import { randomUUID } from 'expo-crypto';
import { createRepoImpl } from './impl';
import {
  assertUsableOwnerId,
  ownerIdForAccount,
  ownerIdForAnonymousSession,
} from './ownership';
import type { Repo, RepoStore } from './types';

export type { Repo } from './types';

let storePromise: Promise<RepoStore> | null = null;
/** Null means use the store's durable anonymous namespace. */
let activeOwnerOverride: string | null = null;

function getStore(): Promise<RepoStore> {
  if (!storePromise) storePromise = createRepoImpl();
  return storePromise;
}

/**
 * Singleton repo. Native → SQLite (offline-first, CLAUDE.md rule 5).
 * Web → AsyncStorage-backed memory impl (resolved via impl.web.ts so the
 * sqlite/wasm code never enters the web bundle).
 */
export async function getRepo(): Promise<Repo> {
  const store = await getStore();
  return store.forOwner(activeOwnerOverride ?? store.getAnonymousOwnerId());
}

/** Set the owner used by ordinary feature-level `getRepo()` calls. */
export function setRepoAccount(accountId: string | null): void {
  activeOwnerOverride = accountId === null ? null : ownerIdForAccount(accountId);
}

/**
 * Return a repository pinned to one account for an entire background job.
 * Unlike the active facade, an auth transition cannot retarget this instance.
 */
export async function getRepoForAccount(accountId: string): Promise<Repo> {
  const store = await getStore();
  return store.forOwner(ownerIdForAccount(accountId));
}

/**
 * Switch to a brand-new signed-out namespace immediately, then persist it.
 * This prevents sign-out from revealing data left by a previous guest session.
 */
export async function startFreshAnonymousRepoContext(): Promise<void> {
  const ownerId = ownerIdForAnonymousSession(randomUUID());
  assertUsableOwnerId(ownerId);
  activeOwnerOverride = ownerId;
  const store = await getStore();
  await store.setAnonymousOwnerId(ownerId);
}

/** Restore the durable signed-out namespace (used during auth rehydration). */
export function useStoredAnonymousRepoContext(): void {
  activeOwnerOverride = null;
}

/** Permanently remove one account's local rows after server-side deletion. */
export async function deleteRepoAccountData(accountId: string): Promise<void> {
  const store = await getStore();
  await store.deleteOwnerData(ownerIdForAccount(accountId));
}
