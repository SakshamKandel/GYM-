import { accounts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, eq, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { type AuditActor, logAudit } from './authz';
import { syncEliteCoachAssignment } from './coachAutoAssign';
import { getDb } from './db';

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

/**
 * Provenance of a tier grant, stamped onto accounts.tier_source (§4.4). Lets
 * the RevenueCat webhook avoid clobbering an admin/manual/coach grant that is
 * still in force (B4). 'console' = admin override, 'manual_payment' = approved
 * Nepal request, 'revenuecat' = verified store entitlement, 'preview' =
 * signed-out/self-serve preview pick, 'coach' = coach-initiated client comp.
 */
export type TierSource = 'console' | 'manual_payment' | 'revenuecat' | 'preview' | 'coach';

/**
 * Explicit sentinel for `TierDates.startsAt` (P1-9). Pass this to deliberately
 * NULL out `tierStartedAt`. A plain `null` (or `undefined`) now LEAVES the
 * column untouched, so a console/coach save that doesn't know the member's
 * stored start date — e.g. the Subscriptions search path, whose list endpoint
 * omits `tierStartedAt` and therefore submits a blank start field — can no
 * longer silently wipe a real start timestamp. `expiresAt` keeps its original
 * `null = permanent` meaning; only `startsAt`'s null semantics changed.
 */
export const CLEAR_TIER_START: unique symbol = Symbol('clearTierStart');

/** Optional dated-subscription window for a tier change. */
export interface TierDates {
  /**
   * When the tier takes effect.
   *  - a `Date` sets `tierStartedAt`
   *  - `undefined` OR `null` leaves the column untouched (a blank start field
   *    can no longer wipe a stored start — P1-9)
   *  - `CLEAR_TIER_START` explicitly nulls the column
   */
  startsAt?: Date | null | typeof CLEAR_TIER_START;
  /** When it lapses. `null` = no expiry (permanent). `undefined` leaves as-is. */
  expiresAt?: Date | null;
}

export interface TierSourceExpectation {
  source: TierSource | null;
  sourceId: string | null;
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
 *     passes `dates`). For `expiresAt`, `undefined` leaves the column untouched
 *     and `null` clears it (null expiry = permanent). For `startsAt`, a `Date`
 *     sets it, `CLEAR_TIER_START` clears it, and `null`/`undefined` leave it
 *     untouched (P1-9 — a blank start field never wipes a stored start).
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
  source?: TierSource | null,
  sourceId?: string | null,
  sourceEventAt?: Date,
  expectedCurrentSource?: TierSourceExpectation,
): Promise<boolean> {
  const db = getDb();

  // Build the column set: tier always; date columns only when the caller opted
  // in (undefined = leave alone, null = clear, Date = set). `source` stamps
  // provenance (§4.4) so the RevenueCat webhook can protect manual/console/coach
  // grants (B4); omitted = leave the column untouched.
  const set: {
    tier: Tier;
    tierStartedAt?: Date | null;
    tierExpiresAt?: Date | null;
    tierSource?: TierSource | null;
    tierSourceId?: string | null;
    revenuecatEventAt?: Date;
  } = { tier };
  // startsAt (P1-9): a Date sets the column; CLEAR_TIER_START explicitly nulls
  // it; `null`/`undefined` leave it untouched so a save that never learned the
  // stored start (blank field) can't overwrite a real start timestamp with null.
  if (dates?.startsAt === CLEAR_TIER_START) {
    set.tierStartedAt = null;
  } else if (dates?.startsAt instanceof Date) {
    set.tierStartedAt = dates.startsAt;
  }
  if (dates?.expiresAt !== undefined) set.tierExpiresAt = dates.expiresAt;
  if (source !== undefined) {
    set.tierSource = source;
    set.tierSourceId = sourceId ?? null;
  }
  if (sourceEventAt !== undefined) set.revenuecatEventAt = sourceEventAt;

  // Source of truth. Store events are accepted only when newer than the last
  // observed event. The same event id/timestamp may retry after a partial
  // failure; it is allowed to converge on the same values.
  let where: SQL | undefined = eq(accounts.id, accountId);
  if (sourceEventAt) {
    where = and(
        eq(accounts.id, accountId),
        or(
          isNull(accounts.revenuecatEventAt),
          lt(accounts.revenuecatEventAt, sourceEventAt),
          and(
            eq(accounts.revenuecatEventAt, sourceEventAt),
            eq(accounts.tierSourceId, sourceId ?? ''),
          ),
        ),
      );
  }
  if (expectedCurrentSource) {
    const sourceCondition =
      expectedCurrentSource.source === null
        ? isNull(accounts.tierSource)
        : eq(accounts.tierSource, expectedCurrentSource.source);
    const sourceIdCondition =
      expectedCurrentSource.sourceId === null
        ? isNull(accounts.tierSourceId)
        : eq(accounts.tierSourceId, expectedCurrentSource.sourceId);
    where = and(where, sourceCondition, sourceIdCondition);
  }
  const updated = await db
    .update(accounts)
    .set(set)
    .where(where)
    .returning({ id: accounts.id });
  if (!updated[0]) return false;

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
    source,
    sourceId,
    // Audit records the resulting value: a Date → its ISO string, an explicit
    // clear (CLEAR_TIER_START) → null; a bare null/undefined leaves the column
    // untouched, so it is omitted from the audit meta (P1-9).
    startsAt:
      dates?.startsAt instanceof Date
        ? dates.startsAt.toISOString()
        : dates?.startsAt === CLEAR_TIER_START
          ? null
          : undefined,
    expiresAt: dates?.expiresAt !== undefined ? isoOrNull(dates.expiresAt) : undefined,
  });
  return true;
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d instanceof Date ? d.toISOString() : null;
}
