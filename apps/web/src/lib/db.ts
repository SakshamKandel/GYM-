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
