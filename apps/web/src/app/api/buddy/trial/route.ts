import { accounts, trialUsage } from '@gym/db';
import { compareTiers, effectiveTier } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

const TRIAL_DAYS = 2;

/**
 * Tier grants somebody PAID for (or that staff issued deliberately). A trial
 * writes ONE tier plus ONE expiry — the account row cannot hold a paid window
 * and a trial window at the same time — so a trial must never be applied on
 * top of one of these while it is still in force. See the guard in POST.
 */
const PURCHASED_TIER_SOURCES: ReadonlySet<string> = new Set([
  'console',
  'manual_payment',
  'revenuecat',
  'coach',
]);

const bodySchema = z.object({
  tier: z.enum(['silver', 'gold', 'elite']),
});

export function OPTIONS() {
  return preflight();
}

/** GET — trial status for this account (which tiers have been trialed). */
export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const rows = await db
    .select({
      tier: trialUsage.tier,
      startedAt: trialUsage.startedAt,
      expiresAt: trialUsage.expiresAt,
    })
    .from(trialUsage)
    .where(eq(trialUsage.accountId, me.id));

  const now = new Date();
  const trials = rows.map((r) => ({
    tier: r.tier,
    startedAt: r.startedAt,
    expiresAt: r.expiresAt,
    active: now < r.expiresAt,
  }));

  return json({ trials, trialDays: TRIAL_DAYS }, 200);
}

/**
 * POST — start a 2-day trial for a tier (one-time per tier per account, and
 * only on an account that is not currently holding a paid or longer window).
 */
export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const tier = parsed.data.tier;

  // A trial may only ever be an UPGRADE. `me.tier` is the EFFECTIVE tier
  // (userForToken already collapsed a lapsed paid tier to 'starter'), so if the
  // account is already at or above the requested tier we refuse WITHOUT touching
  // accounts or burning the one-time trial — otherwise a Gold/Elite member who
  // taps a lower-tier trial card would be silently DOWNGRADED (and, for a paid
  // member, keep the old future expiry, losing paid features until re-purchase).
  if (compareTiers(me.tier, tier) >= 0) {
    return json({ error: 'not_an_upgrade', currentTier: me.tier }, 409);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

  // MONEY GUARD. A trial does not stack: it OVERWRITES accounts.tier and
  // accounts.tierExpiresAt with a two-day window. On an account that is paying
  // for a lower tier (Silver bought until next year, tapping the Gold trial)
  // that replaced a purchased window with a two-day one and the member lost the
  // access they had paid for the moment the trial lapsed. So the trial is
  // refused whenever the account currently holds:
  //   - a grant somebody paid for or staff issued, still in force, or
  //   - any non-free window that outlasts the trial (including a permanent one,
  //     expiry null, which is how the very old free-upgrade rows look).
  // A free account is the only thing a trial may ever write over, and it can
  // only ever move it forward. Refusing costs a member one trial offer;
  // guessing wrong costs them a subscription, so this stays deliberately blunt.
  const [account] = await db
    .select({
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      tierSource: accounts.tierSource,
      tierSourceId: accounts.tierSourceId,
    })
    .from(accounts)
    .where(eq(accounts.id, me.id))
    .limit(1);
  if (!account) return json({ error: 'unauthorized' }, 401);

  const holdsPaidGrant =
    account.tier !== 'starter' &&
    account.tierSource !== null &&
    PURCHASED_TIER_SOURCES.has(account.tierSource) &&
    effectiveTier(account.tier, account.tierExpiresAt, now) !== 'starter';
  const holdsLongerWindow =
    account.tier !== 'starter' &&
    (account.tierExpiresAt === null || account.tierExpiresAt.getTime() > expiresAt.getTime());

  if (holdsPaidGrant || holdsLongerWindow) {
    return json({ error: 'subscription_active', currentTier: me.tier }, 409);
  }

  // Check if trial already used for this tier.
  const existing = await db
    .select({ id: trialUsage.id, expiresAt: trialUsage.expiresAt })
    .from(trialUsage)
    .where(and(eq(trialUsage.accountId, me.id), eq(trialUsage.tier, tier)))
    .limit(1);

  if (existing.length > 0) {
    return json({ error: 'trial_used', expiresAt: existing[0].expiresAt }, 409);
  }

  // CONCURRENCY: the pre-check above is check-then-insert (TOCTOU) — two
  // concurrent POSTs would both pass the SELECT and collide on the
  // trial_usage_account_tier unique index as an uncaught 500. onConflictDoNothing
  // maps the loser to the same trial_used 409 as the pre-check, and only the
  // winner (the request that actually created the row) applies the tier.
  const inserted = await db
    .insert(trialUsage)
    .values({
      accountId: me.id,
      tier,
      startedAt: now,
      expiresAt,
    })
    .onConflictDoNothing({ target: [trialUsage.accountId, trialUsage.tier] })
    .returning({ id: trialUsage.id });

  if (inserted.length === 0) {
    const raced = await db
      .select({ expiresAt: trialUsage.expiresAt })
      .from(trialUsage)
      .where(and(eq(trialUsage.accountId, me.id), eq(trialUsage.tier, tier)))
      .limit(1);
    return json({ error: 'trial_used', expiresAt: raced[0]?.expiresAt ?? null }, 409);
  }

  // Apply the tier THROUGH the audited writer, with the SAME expiry window as
  // the trial_usage row — effectiveTier() collapses it back to 'starter' at
  // the auth choke point the moment the trial lapses (no cron needed). The old
  // code wrote accounts.tier directly with NO expiry: a permanent free upgrade.
  //
  // The grant we read for the money guard above is passed back as the expected
  // current state, so the write only lands if nothing has changed the tier in
  // the meantime. A purchase or an admin grant that arrives between the read
  // and this write therefore wins, instead of being overwritten by a trial
  // that was cleared against stale state.
  const applied = await setAccountTier(
    me.id,
    tier,
    { id: me.id },
    'buddy_trial',
    { startsAt: now, expiresAt },
    'preview',
    null,
    undefined,
    { source: account.tierSource, sourceId: account.tierSourceId },
  );

  if (!applied) {
    // The tier moved under us, so no trial was granted. Give the member their
    // one-time trial back rather than charging them for a race they lost.
    try {
      await db.delete(trialUsage).where(eq(trialUsage.id, inserted[0].id));
    } catch (err) {
      console.error('[trial] could not release an unapplied trial record', err);
    }
    return json({ error: 'subscription_active', currentTier: me.tier }, 409);
  }

  return json({ ok: true, tier, expiresAt }, 201);
}
