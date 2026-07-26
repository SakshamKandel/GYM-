import { timingSafeEqual } from 'node:crypto';
import { accounts, mealBillingCycles, mealOrders, notifications } from '@gym/db';
import { cronDedupeKey, ktmDateString, orderNumber } from '@gym/shared';
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { getDb } from './db';
import { json } from './http';
import { advanceOrderStatus } from './meals';
import {
  createNotifyRecipientCache,
  notify,
  redispatch,
  resolveStaffRecipients,
} from './notify';

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

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long AFTER its ordering cutoff a still-`pending` order is auto-cancelled.
 * The cutoff is the last moment the slot can be changed (21:00 the day before
 * for lunch, 10:00 the same day for dinner), and delivery is hours later, so
 * this grace leaves a restaurant that is simply late a real chance to confirm
 * while still freeing the member long before the food was due.
 */
const PENDING_EXPIRY_GRACE_MS = 2 * HOUR_MS;

/** How long a `pending` order may sit unconfirmed before staff are told. */
const PENDING_ESCALATION_MS = 2 * HOUR_MS;

/**
 * Grace past the END of an order's delivery day before a still-`confirmed`
 * order counts as abandoned.
 *
 * Confirming is the restaurant saying yes; nothing then forced it to cook. Such
 * an order used to sit `confirmed` forever — no sweep watched it, and the member
 * was left with an order that was never going to arrive and never going to
 * close. The anchor is deliberately the DELIVERY DAY, not the cutoff: the lunch
 * cutoff is the evening before, so a cutoff-relative grace short enough to be
 * useful for dinner would cancel lunch orders the kitchen was about to cook. A
 * delivery day that is fully over, plus a few hours into the next morning, is
 * unambiguous — nothing is going to be delivered for yesterday.
 */
const CONFIRMED_ABANDON_GRACE_MS = 6 * HOUR_MS;

/**
 * How far back the abandoned-order pass looks.
 *
 * Without a lower bound the pass asks for "every confirmed order whose delivery
 * day has passed, oldest first", which walks the delivery-date index from the
 * very first order the product ever took — almost all of them long since
 * delivered — on every single tick, forever, and gets slower every day the
 * platform trades. The candidates it is actually hunting are hours old: the
 * sweep runs daily and cancels an abandoned order the morning after its
 * delivery day, so a month of history is a wide margin, not a limit anyone
 * reaches. It goes away entirely once `meal_orders` carries a partial index on
 * `status = 'confirmed'` (see the note on the pass below).
 */
const CONFIRMED_ABANDON_LOOKBACK_DAYS = 30;

/**
 * The dedupe key the staff escalation notice is stored under, minus the
 * recipient suffix `notify()` appends to every fan-out key.
 *
 * MUST stay byte-identical to
 * `cronDedupeKey('order_placed_partner', 'staff', 'order_waiting:' + orderId)`
 * — the escalation anti-join rebuilds this key in SQL to look each order up in
 * the `notifications_dedupe` unique index.
 */
const ESCALATION_KEY_PREFIX = 'order_placed_partner:staff:order_waiting:';

/** Persisted on the order (and shown in both consoles) when the sweep cancels it. */
const PENDING_EXPIRY_REASON = 'The restaurant did not confirm this order in time.';

/** Persisted when the sweep closes an order the restaurant confirmed but never made. */
const CONFIRMED_ABANDON_REASON = 'The restaurant did not prepare this order.';

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
    // Stamp the ATTEMPT before dispatching, mirroring notify()'s primary path.
    // Sending first and stamping after leaves a window where a crash between the
    // FCM accept and this UPDATE re-delivers the identical push on the next tick.
    await db
      .update(notifications)
      .set({ sentAt: new Date() })
      .where(eq(notifications.id, row.id));
    const resolved = await redispatch({
      accountId: row.accountId,
      event: row.event,
      title: row.title,
      body: row.body,
      data: row.data ?? null,
    });
    if (resolved) {
      dispatched += 1;
    } else {
      // Confirmed transient failure — return the row to the queue for a later tick.
      await db
        .update(notifications)
        .set({ sentAt: null })
        .where(eq(notifications.id, row.id));
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
  // 3 days back (not 2): the window is wider than the daily tick interval, so a
  // skipped or failed cron day is still recoverable on the next run instead of
  // silently aging its signups out un-nudged. Safe to widen — the anti-join and
  // the constant dedupe scope below keep this a single nudge per account, ever.
  const windowStart = new Date(now.getTime() - 3 * DAY_MS);
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

/**
 * stale-orders: the fulfilment-side sweep. A restaurant that never opens the
 * portal simply never acts on an order, and nothing else in the system ever
 * closes it, so the member was left watching a `pending` order past the moment
 * the food was due. Two passes, both bounded and safe to run twice:
 *
 *  1. EXPIRE — a `pending` order still unconfirmed `PENDING_EXPIRY_GRACE_MS`
 *     after its cutoff is cancelled through {@link advanceOrderStatus}, the same
 *     helper every console cancel uses. That is deliberate: the member push, the
 *     append-only `meal_order_events` row, the `cancelled_at`/`cancel_reason`
 *     bookkeeping and the money backstop all happen exactly as they do for a
 *     human cancel, so an auto-cancel is indistinguishable downstream.
 *     Idempotency is the CAS itself (`status = 'pending'`): a second run finds
 *     the row already cancelled, writes nothing and notifies nobody. That also
 *     gives forward progress, since a handled row leaves the candidate set.
 *
 *     Orders with money in flight (`receipt_submitted` / `paid`) are NOT
 *     cancelled here — the destructive-transition guard would refuse them
 *     anyway, and stranding captured money is support's call, not a cron's.
 *     They go to pass 2 instead, so a human sees them and can run the refund +
 *     cancel together.
 *
 *  1b. ABANDON — the same cancel, one status further along: an order the
 *     restaurant CONFIRMED and then never prepared. Accepting an order is not
 *     making it, and nothing in the machine forces the next step, so these sat
 *     `confirmed` forever with nobody watching. Cancelled once the whole
 *     delivery day has passed (+ `CONFIRMED_ABANDON_GRACE_MS`), through the
 *     same helper, with the same money exclusion and the same CAS idempotency.
 *
 *  2. ESCALATE — a `pending` order older than `PENDING_ESCALATION_MS` that
 *     pass 1 did not (or could not) cancel nudges the restaurant again and tells
 *     staff, so someone can phone the kitchen while the order can still be
 *     saved. Idempotency + forward progress come from the per-order `dedupeKey`
 *     and the anti-join against it (an equality lookup on the same unique index
 *     that enforces it, same shape as cycle-dunning).
 *
 * The two pending passes read `meal_orders` through the `meal_orders_pending_*`
 * partial indexes — pending orders are a sliver of the table, and each pass's
 * sort key is that index's key, so neither pass ever scans or sorts order
 * history. Pass 1b sorts on `deliveryDate` (the `meal_orders_delivery_date`
 * index), capped at BATCH and bounded to the last
 * {@link CONFIRMED_ABANDON_LOOKBACK_DAYS} days so it reads a slice of that index
 * rather than every order ever placed; it still wants a
 * `where status = 'confirmed'` partial index of its own, after which the
 * lookback bound can go.
 */
export async function runStaleOrders(now: Date = new Date()): Promise<CronResult> {
  const startedAt = Date.now();
  const db = getDb();
  const expiryCutoff = new Date(now.getTime() - PENDING_EXPIRY_GRACE_MS);

  // The staff fan-out set is resolved ONCE for the whole run and handed to every
  // notify() below. Without it each of the (up to 2 × BATCH) staff notifications
  // in this sweep re-reads the whole `admins` + `admin_permission_overrides`
  // tables to compute an answer that is identical every time.
  const recipients = createNotifyRecipientCache();
  const escalationStaff = await resolveStaffRecipients('orders.review', recipients);

  // --- Pass 1: cancel orders the restaurant never confirmed -----------------
  const expired = await db
    .select({
      id: mealOrders.id,
      accountId: mealOrders.accountId,
      partnerId: mealOrders.partnerId,
    })
    .from(mealOrders)
    .where(
      and(
        eq(mealOrders.status, 'pending'),
        lte(mealOrders.cutoffAt, expiryCutoff),
        // Money-in-flight orders are pass 2's problem (see the note above).
        inArray(mealOrders.paymentStatus, ['unpaid', 'refunded']),
      ),
    )
    .orderBy(asc(mealOrders.cutoffAt))
    .limit(BATCH);

  // --- Pass 1b: cancel orders the restaurant confirmed and then abandoned ----
  // Same shape as pass 1, one status further along the machine. `deliveryDate`
  // is a KTM calendar date, so the candidate test is a date compare against the
  // KTM day of (now − grace): every order whose delivery day is fully behind us.
  const abandonedBefore = ktmDateString(new Date(now.getTime() - CONFIRMED_ABANDON_GRACE_MS));
  const abandonedAfter = ktmDateString(
    new Date(now.getTime() - CONFIRMED_ABANDON_GRACE_MS - CONFIRMED_ABANDON_LOOKBACK_DAYS * DAY_MS),
  );
  const abandoned = await db
    .select({
      id: mealOrders.id,
      accountId: mealOrders.accountId,
      partnerId: mealOrders.partnerId,
    })
    .from(mealOrders)
    .where(
      and(
        eq(mealOrders.status, 'confirmed'),
        lt(mealOrders.deliveryDate, abandonedBefore),
        // Turns the delivery-date index scan into a range instead of a walk
        // from the beginning of the order book (see the constant).
        gte(mealOrders.deliveryDate, abandonedAfter),
        // Captured money is support's call here exactly as in pass 1 — the
        // destructive-transition guard would refuse these anyway.
        inArray(mealOrders.paymentStatus, ['unpaid', 'refunded']),
      ),
    )
    .orderBy(asc(mealOrders.deliveryDate))
    .limit(BATCH);

  /**
   * Cancel one abandoned order and say so. Shared by both passes so an
   * auto-cancel is byte-for-byte a human cancel downstream: the CAS, the
   * append-only `meal_order_events` row, the timestamps and the member push all
   * come from {@link advanceOrderStatus}. Idempotent — the CAS on
   * `expectedStatus` writes nothing on a second run, and every notification is
   * keyed per order, so running this twice notifies nobody twice.
   */
  async function cancelAbandoned(
    row: { id: string; accountId: string; partnerId: string },
    expectedStatus: 'pending' | 'confirmed',
    cancelReason: string,
    keySuffix: string,
    copy: { member: string; partner: string; staffTitle: string; staff: string },
  ): Promise<boolean> {
    const advanced = await advanceOrderStatus({
      db,
      orderId: row.id,
      expectedStatus,
      toStatus: 'cancelled',
      actor: 'admin',
      // No human decided this, so `decided_by` stays null rather than borrowing
      // a staff identity the audit trail would then misattribute.
      actorId: null,
      cancelReason,
      now,
    });
    // Lost the CAS: the restaurant moved it on in the meantime (or a previous
    // run already cancelled it). Either way there is nothing left to say.
    if (!advanced.ok) return false;

    // advanceOrderStatus already sent the member the plain "Order cancelled"
    // status push; this is the WHY, mirroring the partner-refuse route.
    await notify(
      'order_status',
      { accountId: row.accountId },
      { title: 'Order cancelled', body: copy.member, data: { type: 'order', id: row.id } },
      { dedupeKey: cronDedupeKey('order_status', row.accountId, `${keySuffix}:${row.id}`) },
    );
    await notify(
      'order_cancelled_partner',
      { partnerId: row.partnerId },
      { title: 'Order cancelled', body: copy.partner, data: { type: 'order', id: row.id } },
      {
        dedupeKey: cronDedupeKey('order_cancelled_partner', row.partnerId, `${keySuffix}:${row.id}`),
      },
    );
    await notify(
      'order_cancelled_partner',
      { role: 'staff', permission: 'orders.review' },
      { title: copy.staffTitle, body: copy.staff, data: { type: 'order', id: row.id } },
      // A fan-out key is namespaced per recipient by notify(), so the literal
      // 'staff' segment is only there to keep this key distinct from the
      // partner's above.
      {
        dedupeKey: cronDedupeKey('order_cancelled_partner', 'staff', `${keySuffix}:${row.id}`),
        recipients,
      },
    );
    return true;
  }

  let cancelled = 0;
  for (const row of expired) {
    const code = orderNumber(row.id);
    const done = await cancelAbandoned(row, 'pending', PENDING_EXPIRY_REASON, 'order_expired', {
      member: `Order ${code} was cancelled because the restaurant did not confirm it in time. Sorry about that.`,
      partner: `Order ${code} was cancelled because it was not confirmed in time.`,
      staffTitle: 'An order expired unconfirmed',
      staff: `Order ${code} was cancelled for the member because the restaurant never confirmed it.`,
    });
    if (done) cancelled += 1;
  }

  for (const row of abandoned) {
    const code = orderNumber(row.id);
    const done = await cancelAbandoned(
      row,
      'confirmed',
      CONFIRMED_ABANDON_REASON,
      'order_abandoned',
      {
        member: `Order ${code} was cancelled because the restaurant never prepared it. Sorry about that.`,
        partner: `Order ${code} was cancelled because it was accepted but never prepared.`,
        staffTitle: 'An order was accepted but never made',
        staff: `Order ${code} was cancelled for the member because the restaurant accepted it and never prepared it.`,
      },
    );
    if (done) cancelled += 1;
  }

  // --- Pass 2: escalate orders that are still waiting on the restaurant -----
  const escalateBefore = new Date(now.getTime() - PENDING_ESCALATION_MS);
  // Forward progress: drop orders staff were already told about. The stored key
  // is the escalation key with the recipient appended, and the recipients are
  // exactly the set resolved above, so each candidate key can be spelled out in
  // full and looked up by EQUALITY in the `notifications_dedupe` unique index.
  //
  // This used to be `starts_with(dedupe_key, <prefix built from the order id>)`.
  // A function call over a computed prefix is opaque to the planner, so it could
  // use no index at all: every candidate order re-read the entire notifications
  // table, i.e. the whole history of every push the product has ever sent.
  //
  // There is no time window on the lookup any more. The dedupe unique has no
  // expiry, so a key found at ANY age already means `notify` would refuse to
  // send again; a window only let long-dead orders back into the candidate set
  // to be re-selected forever, crowding out the tail they were sorted behind.
  //
  // Empty set = nobody holds `orders.review`, so there is nobody to escalate to
  // and no key to match. Every candidate then stays in the set: the partner
  // nudge is still deduped per order, so this costs a repeated no-op scan, never
  // a repeated notification.
  const alreadyEscalated = or(
    ...escalationStaff.map(
      (accountId) =>
        sql`${notifications.dedupeKey} = ${ESCALATION_KEY_PREFIX} || ${mealOrders.id} || ':' || ${accountId}`,
    ),
  );
  const waiting = await db
    .select({
      id: mealOrders.id,
      partnerId: mealOrders.partnerId,
      deliveryDate: mealOrders.deliveryDate,
      window: mealOrders.window,
    })
    .from(mealOrders)
    .where(
      and(
        eq(mealOrders.status, 'pending'),
        lte(mealOrders.placedAt, escalateBefore),
        // Everything pass 1 could cancel is excluded, so one order is never
        // both cancelled and escalated in the same run. The second half is what
        // catches a PREPAID order past its cutoff: pass 1 must leave captured
        // money alone, so without this it would sit pending with nobody told.
        or(
          gt(mealOrders.cutoffAt, expiryCutoff),
          notInArray(mealOrders.paymentStatus, ['unpaid', 'refunded']),
        ),
        alreadyEscalated
          ? notExists(db.select({ one: sql`1` }).from(notifications).where(alreadyEscalated))
          : undefined,
      ),
    )
    .orderBy(asc(mealOrders.placedAt))
    .limit(BATCH);

  for (const row of waiting) {
    const code = orderNumber(row.id);
    const slot = row.window === 'lunch' ? 'lunch' : 'dinner';
    await notify(
      'order_placed_partner',
      { partnerId: row.partnerId },
      {
        title: 'An order is still waiting',
        body: `Order ${code} for ${slot} on ${row.deliveryDate} has not been confirmed yet. Please confirm or reject it.`,
        data: { type: 'order', id: row.id },
      },
      {
        dedupeKey: cronDedupeKey('order_placed_partner', row.partnerId, `order_waiting:${row.id}`),
      },
    );
    await notify(
      'order_placed_partner',
      { role: 'staff', permission: 'orders.review' },
      {
        title: 'A restaurant has not answered',
        body: `Order ${code} for ${slot} on ${row.deliveryDate} is still unconfirmed by the restaurant. Worth a call.`,
        data: { type: 'order', id: row.id },
      },
      // MUST stay byte-identical to the key the anti-join above rebuilds.
      {
        dedupeKey: cronDedupeKey('order_placed_partner', 'staff', `order_waiting:${row.id}`),
        recipients,
      },
    );
  }

  const result = {
    scanned: expired.length + abandoned.length + waiting.length,
    dispatched: cancelled + waiting.length,
    durationMs: Date.now() - startedAt,
  };
  console.log(
    `[cron:stale-orders] scanned=${result.scanned} cancelled=${cancelled} escalated=${waiting.length} ms=${result.durationMs}`,
  );
  return result;
}
