import { createRepoImpl } from './impl';
import type { Repo } from './types';

export type { Repo } from './types';

let repoPromise: Promise<Repo> | null = null;

/**
 * Singleton repo. Native → SQLite (offline-first, CLAUDE.md rule 5).
 * Web → AsyncStorage-backed memory impl (resolved via impl.web.ts so the
 * sqlite/wasm code never enters the web bundle).
 */
export function getRepo(): Promise<Repo> {
  if (!repoPromise) {
    repoPromise = createRepoImpl();
  }
  return repoPromise;
}
