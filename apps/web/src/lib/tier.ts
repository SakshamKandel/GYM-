import { accounts } from '@gym/db';
import { eq, sql } from 'drizzle-orm';
import { type Principal, logAudit } from './authz';
import { getDb } from './db';

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

/**
 * Changes an account's subscription tier. `accounts.tier` is the auth source of
 * truth; we also mirror the value into `account_profiles.data->>'tier'` (jsonb
 * merge that preserves the rest of the blob). If the account has no profile row
 * yet, the mirror is skipped (we never fabricate a profile here). Finally writes
 * a 'subscription.override' audit row attributed to `actor`.
 *
 * Callers must have gated on the 'subscription.override' permission first.
 */
export async function setAccountTier(
  accountId: string,
  tier: Tier,
  actor: Principal,
  reason?: string,
): Promise<void> {
  const db = getDb();

  // Source of truth.
  await db.update(accounts).set({ tier }).where(eq(accounts.id, accountId));

  // Mirror onto the jsonb profile blob WITHOUT clobbering sibling keys. The
  // WHERE guard means a missing profile row is left untouched (skipped).
  await db.execute(sql`
    update account_profiles
    set data = data || ${sql`jsonb_build_object('tier', ${tier}::text)`},
        updated_at = now()
    where account_id = ${accountId}
  `);

  await logAudit(actor, 'subscription.override', 'account', accountId, {
    tier,
    reason,
  });
}
