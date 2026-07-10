import { accounts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import { type AuditActor, logAudit } from './authz';
import { syncEliteCoachAssignment } from './coachAutoAssign';
import { getDb } from './db';

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

/** Optional dated-subscription window for a tier change. */
export interface TierDates {
  /** When the tier takes effect. `null` clears it; `undefined` leaves it as-is. */
  startsAt?: Date | null;
  /** When it lapses. `null` = no expiry (permanent). `undefined` leaves as-is. */
  expiresAt?: Date | null;
}

/**
 * Changes an account's subscription tier and (optionally) its dated window.
 *
 * `accounts.tier` is the auth source of truth; expiry is enforced downstream by
 * `effectiveTier` at the auth choke point (userForToken / api/me / login), so a
 * lapsed paid tier loses access with NO cron — we never mutate `tier` on expiry.
 *
 * Behavior:
 *  1. Writes accounts.tier (+ tierStartedAt / tierExpiresAt when the caller
 *     passes `dates.startsAt` / `dates.expiresAt`; `undefined` leaves a column
 *     untouched, `null` clears it — null expiry = permanent).
 *  2. Mirrors the tier into account_profiles.data->>'tier' (jsonb merge that
 *     preserves sibling keys). Skipped when the account has no profile row.
 *  3. Syncs the Greece auto-assignment based on the account's NEW EFFECTIVE
 *     tier (elite → ensure active; below elite → end the auto-created row).
 *     Best-effort: an assignment-sync failure must not fail the tier write.
 *  4. Writes a 'subscription.override' audit row (incl. the dates) as `actor`.
 *
 * Callers must have gated on the appropriate permission first (this helper
 * gates nothing itself). `actor` is a staff Principal for console overrides,
 * or `{ id: accountId }` for audited SELF-SERVE writes (subscription/tier,
 * buddy trial) — never a client-supplied value.
 */
export async function setAccountTier(
  accountId: string,
  tier: Tier,
  actor: AuditActor,
  reason?: string,
  dates?: TierDates,
): Promise<void> {
  const db = getDb();

  // Build the column set: tier always; date columns only when the caller opted
  // in (undefined = leave alone, null = clear, Date = set).
  const set: {
    tier: Tier;
    tierStartedAt?: Date | null;
    tierExpiresAt?: Date | null;
  } = { tier };
  if (dates?.startsAt !== undefined) set.tierStartedAt = dates.startsAt;
  if (dates?.expiresAt !== undefined) set.tierExpiresAt = dates.expiresAt;

  // Source of truth.
  await db.update(accounts).set(set).where(eq(accounts.id, accountId));

  // Mirror onto the jsonb profile blob WITHOUT clobbering sibling keys. The
  // WHERE guard means a missing profile row is left untouched (skipped).
  await db.execute(sql`
    update account_profiles
    set data = data || ${sql`jsonb_build_object('tier', ${tier}::text)`},
        updated_at = now()
    where account_id = ${accountId}
  `);

  // The tier actually in force after this write drives auto-assignment:
  // setting elite with an already-past expiry must NOT assign Greece. When the
  // caller doesn't override expiry, read the row's EXISTING value — otherwise a
  // dateless re-set of a lapsed member would resurrect a ghost assignment for a
  // client whose effective tier is still starter.
  let effectiveExpiry: Date | null;
  if (dates?.expiresAt !== undefined) {
    effectiveExpiry = dates.expiresAt ?? null;
  } else {
    const [row] = await db
      .select({ expiresAt: accounts.tierExpiresAt })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    effectiveExpiry = row?.expiresAt ?? null;
  }
  const effective = effectiveTier(tier, effectiveExpiry, new Date());
  await syncEliteCoachAssignment(accountId, effective, actor);

  await logAudit(actor, 'subscription.override', 'account', accountId, {
    tier,
    reason,
    startsAt: dates?.startsAt !== undefined ? isoOrNull(dates.startsAt) : undefined,
    expiresAt: dates?.expiresAt !== undefined ? isoOrNull(dates.expiresAt) : undefined,
  });
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d instanceof Date ? d.toISOString() : null;
}
