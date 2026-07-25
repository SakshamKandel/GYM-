import { createDb, type Db } from '@gym/db';

let db: Db | null = null;

/** Lazy singleton so `next build` doesn't require DATABASE_URL at compile time. */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set — copy it into apps/web/.env.local');
    }
    db = createDb(url);
  }
  return db;
}

/**
 * Escapes the LIKE/ILIKE metacharacters in a user-supplied search term so a
 * member typing `%` or `_` searches for that character instead of turning the
 * query into a wildcard scan. Pair with an explicit `escape '\'` or drizzle's
 * default. Was copy-pasted into the members and payment-requests admin lists.
 */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, '\\$&');
}

/**
 * The SQLSTATE off a thrown Postgres/driver error, when present (e.g. '23503'
 * foreign-key violation, '23505' unique violation), else null. Lets a handler
 * turn one known constraint failure into a precise 4xx and re-throw everything
 * else, rather than guessing from the driver's message text.
 */
export function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}
