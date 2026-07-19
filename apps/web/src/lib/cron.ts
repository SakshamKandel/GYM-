import { timingSafeEqual } from 'node:crypto';
import { accounts, mealBillingCycles, notifications } from '@gym/db';
import { cronDedupeKey, ktmDateString } from '@gym/shared';
import { and, asc, eq, gt, isNull, lt, lte, ne, notExists, sql } from 'drizzle-orm';
import { getDb } from './db';
import { json } from './http';
import { notify, redispatch } from './notify';

/**
 * lib/cron.ts — the scheduled/async notification class (Pack B / WP-2). The
 * scan logic lives here as plain functions so BOTH the individual
 * `/api/cron/<name>` routes AND the consolidated `/api/cron/tick` dispatcher
 * share one implementation (the tick is the Hobby-plan-safe single-entry
 * mechanism; Pro can split into per-endpoint schedules — see the route files).
 *
 * Every scan is:
 *  - BOUNDED: a hard `BATCH` cap per run (§7.4-P2 — never load the whole table;
 *    the `accounts_tier_expires` partial index keeps the tier scans an index
 *    scan). Stragglers past the cap are picked up on the next tick.
 *  - FORWARD-PROGRESSING: every scan anti-joins the durable `notifications`
 *    outbox and orders deterministically, so a row already notified for its
 *    current scope drops out of the candidate set on the next tick. Without this
 *    an unordered `.limit(BATCH)` re-selects the same head set forever and any
 *    overflow past `BATCH` is never reached (the dedupeKey stops a double-SEND
 *    but does NOT shrink the WHERE-matched set) — so a >BATCH window would
 *    permanently starve its tail (e.g. day2-reengage's single-shot nudge).
 *  - IDEMPOTENT: cron-driven `notify` calls stamp a `dedupeKey` so a re-run /
 *    Vercel double-fire is a no-op via the `notifications_dedupe` partial unique.
 *  - BEST-EFFORT: `notify` never throws; a single bad row can't abort the scan.
 */

/** Max rows a single scan processes — the per-run page cap (§7.4-P2). */
const BATCH = 500;

/** retry-unsent only re-attempts recent stragglers; older nulls have aged out. */
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How many days AFTER a paid tier lapses the "your plan ended" notice fires. */
const EXPIRY_GRACE_DAYS = 2;

/** How many days BEFORE expiry the renewal nudge fires. */
const RENEWAL_LEAD_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CronResult {
  /** Rows the scan examined this run (≤ BATCH). */
  scanned: number;
  /** Notifications dispatched / rows resolved this run. */
  dispatched: number;
  /** Wall-clock cost, for the §9.3 `cron_run{duration}` metric. */
  durationMs: number;
}

// --- Auth + flag guards (§7.2-S4 / §9.1) -------------------------------------

/**
 * Fail-closed cron authorization. Vercel Cron attaches
 * `Authorization: Bearer $CRON_SECRET` to each invocation; this validates it in
 * constant time.
 *  - returns `null`  → CRON_SECRET is UNSET → the handler MUST 500 (never run
 *    open — a missing secret is a misconfiguration, not permission).
 *  - returns `false` → header missing / mismatch → 401.
 *  - returns `true`  → authorized.
 */
export function cronAuthorized(req: Request): boolean | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const provided = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Master kill-switch — crons stay dark until verified in prod (§9.1). */
export function cronEnabled(): boolean {
  return process.env.NOTIFICATIONS_CRON_ENABLED === 'true';
}

/**
 * Shared route guard: 500 when CRON_SECRET is unset (fail-closed), 401 on a
 * missing/bad bearer, else null to proceed. The flag check is deliberately
 * SEPARATE (a disabled cron returns 200 `{skipped}`, not an error) so a Vercel
 * schedule doesn't log failures while the subsystem ships dark.
 */
export function cronGuard(req: Request): Response | null {
  const ok = cronAuthorized(req);
  if (ok === null) return json({ error: 'cron_not_configured' }, 500);
  if (!ok) return json({ error: 'unauthorized' }, 401);
  return null;
}

/** KTM wall-clock hour (0-23) — the tick dispatcher's daily fan-out gate. */
export function ktmHour(now: Date): number {
  const KTM_OFFSET_MS = 345 * 60_000;
  return new Date(now.getTime() + KTM_OFFSET_MS).getUTCHours();
}

// --- Scans -------------------------------------------------------------------

/**
 * retry-unsent (E2 durable outbox): re-dispatch inbox rows whose push never
 * landed (`sentAt IS NULL`) within the recent window. A crash between the DB
 * commit and the FCM send lands here; quiet-hours rows never do (they were
 * written already-resolved). Bounded + dedupe-free (the row already exists).
 */
export async function runRetryUnsent(now: Date = new Date()): Promise<CronResult> {
  const startedAt = Date.now();
  const db = getDb();
  const cutoff = new Date(now.getTime() - RETRY_WINDOW_MS);
  const rows = await db
    .select({
      id: notifications.id,
      accountId: notifications.accountId,
      event: notifications.event,
      title: notifications.title,
      body: notifications.body,
      data: notifications.data,
    })
    .from(notifications)
    .where(and(isNull(notifications.sentAt), gt(notifications.createdAt, cutoff)))
    .orderBy(asc(notifications.createdAt))
    .limit(BATCH);

  let dispatched = 0;
  for (const row of rows) {
    const resolved = await redispatch({
      accountId: row.accountId,
      event: row.event,
      title: row.title,
      body: row.body,
      data: row.data ?? null,
    });
    if (resolved) {
      await db
        .update(notifications)
        .set({ sentAt: new Date() })
        .where(eq(notifications.id, row.id));
      dispatched += 1;
    }
  }
  const result = { scanned: rows.length, dispatched, durationMs: Date.now() - startedAt };
  console.log(
    `[cron:retry-unsent] scanned=${result.scanned} dispatched=${result.dispatched} ms=${result.durationMs}`,
  );
  return result;
}

/**
 * trial-expiry: paid tiers that lapsed within the grace window get a "your plan
 * ended" notice. Access already collapsed lazily at the auth choke point
 * (effectiveTier), so this is notify-only — the actual tier flip is WP-9's.
 */
export async function runTrialExpiry(now: Date = new Date()): Promise<CronResult> {
  const startedAt = Date.now();
  const db = getDb();
  const graceCutoff = new Date(now.getTime() - EXPIRY_GRACE_DAYS * DAY_MS);
  const rows = await db
    .select({ id: accounts.id, tierExpiresAt: accounts.tierExpiresAt })
    .from(accounts)
    .where(
      and(
        ne(accounts.tier, 'starter'),
        eq(accounts.status, 'active'),
        lte(accounts.tierExpiresAt, now),
        gt(accounts.tierExpiresAt, graceCutoff),
        // Forward progress: skip accounts already notified for THIS expiry. The
        // grace window == the eligibility window, so a `trial_expiry` row inside
        // it is this same lapse; a later distinct expiry falls outside → re-notifies.
        notExists(
          db
            .select({ one: sql`1` })
            .from(notifications)
            .where(
              and(
                eq(notifications.accountId, accounts.id),
                eq(notifications.event, 'trial_expiry'),
                gt(notifications.createdAt, graceCutoff),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(accounts.tierExpiresAt))
    .limit(BATCH);

  for (const row of rows) {
    if (!row.tierExpiresAt) continue;
    await notify(
      'trial_expiry',
      { accountId: row.id },
      {
        title: 'Your plan has ended',
        body: 'Your membership access has expired. Renew any time to bring back your premium features.',
        data: { type: 'tier' },
      },
      { dedupeKey: cronDedupeKey('trial_expiry', row.id, ktmDateString(row.tierExpiresAt)) },
    );
  }
  const result = { scanned: rows.length, dispatched: rows.length, durationMs: Date.now() - startedAt };
  console.log(
    `[cron:trial-expiry] scanned=${result.scanned} dispatched=${result.dispatched} ms=${result.durationMs}`,
  );
  return result;
}

/**
 * renewal-nudge: paid tiers expiring within the lead window get a "renews soon"
 * reminder. One nudge per account per expiry date (dedupe scope = the date).
 */
export async function runRenewalNudge(now: Date = new Date()): Promise<CronResult> {
  const startedAt = Date.now();
  const db = getDb();
  const leadHorizon = new Date(now.getTime() + RENEWAL_LEAD_DAYS * DAY_MS);
  const nudgeSince = new Date(now.getTime() - RENEWAL_LEAD_DAYS * DAY_MS);
  const rows = await db
    .select({ id: accounts.id, tierExpiresAt: accounts.tierExpiresAt })
    .from(accounts)
    .where(
      and(
        ne(accounts.tier, 'starter'),
        eq(accounts.status, 'active'),
        gt(accounts.tierExpiresAt, now),
        lte(accounts.tierExpiresAt, leadHorizon),
        // Forward progress: skip accounts nudged within the last lead window (one
        // nudge per expiry — expiries ≥ lead-window apart re-notify).
        notExists(
          db
            .select({ one: sql`1` })
            .from(notifications)
            .where(
              and(
                eq(notifications.accountId, accounts.id),
                eq(notifications.event, 'renewal_nudge'),
                gt(notifications.createdAt, nudgeSince),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(accounts.tierExpiresAt))
    .limit(BATCH);

  for (const row of rows) {
    if (!row.tierExpiresAt) continue;
    const endsOn = ktmDateString(row.tierExpiresAt);
    await notify(
      'renewal_nudge',
      { accountId: row.id },
      {
        title: 'Your membership renews soon',
        body: `Your plan ends on ${endsOn}. Renew now to keep your access without a gap.`,
        data: { type: 'tier' },
      },
      { dedupeKey: cronDedupeKey('renewal_nudge', row.id, endsOn) },
    );
  }
  const result = { scanned: rows.length, dispatched: rows.length, durationMs: Date.now() - startedAt };
  console.log(
    `[cron:renewal-nudge] scanned=${result.scanned} dispatched=${result.dispatched} ms=${result.durationMs}`,
  );
  return result;
}

/**
 * cycle-dunning: overdue meal-subscription billing cycles (awaiting_payment past
 * their week end) nudge the member to pay. At most one reminder per cycle per
 * day (dedupe scope = cycleId:today). The auto-pause/suspend TRANSITION after N
 * unpaid weeks is WP-4's domain (`autoPauseIfOverdue`); this cron is the notice.
 */
export async function runCycleDunning(now: Date = new Date()): Promise<CronResult> {
  const startedAt = Date.now();
  const db = getDb();
  const today = ktmDateString(now);
  const rows = await db
    .select({ id: mealBillingCycles.id, accountId: mealBillingCycles.accountId })
    .from(mealBillingCycles)
    .where(
      and(
        eq(mealBillingCycles.status, 'awaiting_payment'),
        lt(mealBillingCycles.weekEnd, today),
        // Forward progress: skip cycles already dunned TODAY (exact same-day
        // dedupeKey). Tomorrow's key differs → the cycle re-enters and is dunned
        // again, so overflow past BATCH is reached on a later tick, not starved.
        notExists(
          db
            .select({ one: sql`1` })
            .from(notifications)
            .where(
              eq(
                notifications.dedupeKey,
                sql`'cycle_dunning:' || ${mealBillingCycles.accountId} || ':' || ${mealBillingCycles.id} || ':' || ${today}`,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(mealBillingCycles.weekEnd))
    .limit(BATCH);

  for (const row of rows) {
    await notify(
      'cycle_dunning',
      { accountId: row.accountId },
      {
        title: 'Payment due for your meal plan',
        body: 'A payment for your meal subscription is overdue. Submit it to keep your deliveries running.',
        data: { type: 'cycle', id: row.id },
      },
      { dedupeKey: cronDedupeKey('cycle_dunning', row.accountId, `${row.id}:${today}`) },
    );
  }
  const result = { scanned: rows.length, dispatched: rows.length, durationMs: Date.now() - startedAt };
  console.log(
    `[cron:cycle-dunning] scanned=${result.scanned} dispatched=${result.dispatched} ms=${result.durationMs}`,
  );
  return result;
}

/**
 * day2-reengage: accounts that signed up ~1-2 days ago get a single "ready for
 * day two?" nudge. Dedupe scope is a constant so it fires AT MOST once, ever.
 */
export async function runDay2Reengage(now: Date = new Date()): Promise<CronResult> {
  const startedAt = Date.now();
  const db = getDb();
  const windowStart = new Date(now.getTime() - 2 * DAY_MS);
  const windowEnd = new Date(now.getTime() - DAY_MS);
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.status, 'active'),
        gt(accounts.createdAt, windowStart),
        lte(accounts.createdAt, windowEnd),
        // Forward progress (the critical one): this nudge fires AT MOST ONCE and
        // its 24h eligibility window ages out. Without excluding already-nudged
        // accounts, a day with > BATCH signups re-selects the same head 500 every
        // tick and the overflow ages out un-nudged forever. Order oldest-first so
        // the accounts nearest to aging out are always drained before the rest.
        notExists(
          db
            .select({ one: sql`1` })
            .from(notifications)
            .where(
              and(
                eq(notifications.accountId, accounts.id),
                eq(notifications.event, 'day2_reengage'),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(accounts.createdAt))
    .limit(BATCH);

  for (const row of rows) {
    await notify(
      'day2_reengage',
      { accountId: row.id },
      {
        title: 'Ready for day two?',
        body: 'A quick workout or logged meal today keeps your streak alive. You’ve got this.',
        data: { type: 'home' },
      },
      { dedupeKey: cronDedupeKey('day2_reengage', row.id, 'once') },
    );
  }
  const result = { scanned: rows.length, dispatched: rows.length, durationMs: Date.now() - startedAt };
  console.log(
    `[cron:day2-reengage] scanned=${result.scanned} dispatched=${result.dispatched} ms=${result.durationMs}`,
  );
  return result;
}
