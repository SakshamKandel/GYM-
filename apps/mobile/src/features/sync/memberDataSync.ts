import { getRepoForAccount } from '../../lib/repo';
import { registerMemberDataSyncTrigger } from '../../lib/repo/memberDataTrigger';
import { useAuth } from '../../state/auth';
import { postMemberDataSync } from './memberDataApi';

const MUTATION_BATCH_SIZE = 100;
const MAX_PAGES_PER_RUN = 25;

const inFlightAccounts = new Set<string>();
const rerunAccounts = new Set<string>();

/**
 * Install the repository's post-commit callback. The callback merely starts a
 * background promise; local log writes have already completed when it fires.
 */
export function startMemberDataSync(): () => void {
  return registerMemberDataSyncTrigger(() => {
    void syncMemberData();
  });
}

/**
 * Push local mutations and pull account-owned Neon rows into a repository
 * pinned to the initiating account. Auth changes stop further requests, while
 * an already validated response can safely finish in that old namespace.
 */
export async function syncMemberData(): Promise<void> {
  const initial = useAuth.getState();
  if (initial.status !== 'signedIn' || !initial.token || !initial.user) return;

  const accountId = initial.user.id;
  if (inFlightAccounts.has(accountId)) {
    rerunAccounts.add(accountId);
    return;
  }
  inFlightAccounts.add(accountId);

  try {
    const repo = await getRepoForAccount(accountId);
    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const auth = useAuth.getState();
      if (auth.status !== 'signedIn' || auth.user?.id !== accountId || !auth.token) return;

      const [cursor, mutations] = await Promise.all([
        repo.getMemberDataSyncCursor(),
        repo.getPendingMemberDataMutations(MUTATION_BATCH_SIZE),
      ]);
      const response = await postMemberDataSync(auth.token, { cursor, mutations });
      await repo.applyMemberDataSyncResponse(response);

      const current = useAuth.getState();
      if (current.status !== 'signedIn' || current.user?.id !== accountId) return;

      const remaining = await repo.getPendingMemberDataMutations(1);
      if (!response.hasMore && remaining.length === 0) return;
    }
    // A bounded run cannot monopolize the JS thread. Schedule another pass for
    // very large restores/backlogs without blocking the screen that started it.
    rerunAccounts.add(accountId);
  } catch {
    // Offline, timeout, invalid/expired session, or server error: queue and
    // cursor stay untouched, so app foreground or the next local write retries.
  } finally {
    inFlightAccounts.delete(accountId);
    if (rerunAccounts.delete(accountId)) {
      const current = useAuth.getState();
      if (current.status === 'signedIn' && current.user?.id === accountId) {
        queueMicrotask(() => {
          void syncMemberData();
        });
      }
    }
  }
}
