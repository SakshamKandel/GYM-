import { sql, type SQL } from 'drizzle-orm';

/**
 * Shared transaction-scoped mutex for writes whose correctness depends on a
 * meal partner's active state. Hash collisions only serialize extra partners;
 * they cannot weaken correctness.
 */
export function partnerOperationLockSql(partnerId: string): SQL {
  return sql`select pg_advisory_xact_lock(hashtextextended(${partnerId}, 0))`;
}
