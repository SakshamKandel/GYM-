import {
  accounts,
  mealAvailability,
  mealBillingCycles,
  mealOrders,
  mealPartners,
  meals,
  mealSubSkips,
  mealSubscriptions,
  savedAddresses,
  type Db,
  type MealMacrosSnapshot,
} from '@gym/db';
import {
  buildMaterializationPlan,
  cutoffFor,
  ktmAddDays,
  ktmDateString,
  ktmDayOfWeek,
  weekBoundsFor,
  type CycleStatus,
  type MaterializationSub,
  type MealDeliveryConfig,
  type MealWindow,
  type RotationMeal,
} from '@gym/shared';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { sendPushToAccount } from '@/lib/push';
import { loadDeliveryConfig } from './config';
import { guardedOrderItemInsertSql, mealOrderItemsLockSql } from './orderItemsSql';

/**
 * On-read materialization + weekly billing (§3). There is NO cron: this runs at
 * the top of every order-list route (member upcoming/history, partner queue,
 * admin oversight). It is idempotent and race-safe:
 *
 *  - Materialization spawns one `meal_orders` row per (subscription, deliveryDate,
 *    window) via a single INSERT … ON CONFLICT DO NOTHING against the partial
 *    unique index (invariant §8b) — racing readers can never double-spawn. The
 *    plan is deterministic (rotation resolves purely from date/window), so a
 *    conflict is a true no-op.
 *  - Order horizon is STRICTLY today + tomorrow (KTM); the past never
 *    retro-spawns (§8e). The BILLING horizon is a full week ahead, so a week's
 *    bill always exists before that week's first cutoff (see below).
 *  - Only partners that are live AND accepting orders spawn anything: a paused
 *    (or deactivated) kitchen receives no new subscription orders and its
 *    members are not billed for the weeks it is closed. Pause is forward-only —
 *    orders that already exist are never touched.
 *  - Snapshot: address (name/phone/text) + the day's price are frozen onto the
 *    row at spawn and never re-resolved (§8a).
 *  - Prepaid billing: for DIGITAL (eSewa/Khalti) subscriptions a delivery date is
 *    materialized only when the Sun–Sat cycle covering it is `paid` — "never cook
 *    unpaid". COD subscriptions have no cycle gate (reconciled on delivery).
 *    A cycle's amount is frozen at creation and never repriced here.
 *
 * Never throws: materialization is a best-effort side effect of a read, so a
 * transient failure logs and the route still serves whatever already exists
 * (the next read retries the spawn).
 *
 * Because it is a side effect of a READ, it also has to be cheap when there is
 * nothing to do — every console that stays open re-triggers it. Two things keep
 * that in check: the whole weekly-billing pass is three statements no matter how
 * many plans exist (see `ensureAndBillCycles`), and repeat calls for the same
 * scope inside a short window return immediately (see the throttle below).
 */

export type MaterializeScope =
  | { kind: 'member'; accountId: string }
  | { kind: 'partner'; partnerId: string }
  | { kind: 'all' };

export interface MaterializeOptions {
  /**
   * Run even if this scope was materialized moments ago (see the throttle
   * below). Write paths that must observe their own effect in the SAME request
   * pass true: creating a plan bills its first week and answers with that bill,
   * so a suppressed pass there would hand the member an empty screen.
   *
   * Defaults to true for the `member` scope for exactly that reason, and to
   * false for `partner`/`all` — those are the console surfaces that re-render
   * and re-poll on a timer with no new work to do.
   */
  force?: boolean;
}

/**
 * How long a pass suppresses the next one for the same scope (P0). The partner
 * kitchen board polls every 15 seconds and the admin orders page re-runs a
 * platform-wide pass on every render, so without this a busy dinner service has
 * every open console re-driving the same write-heavy billing sweep four times a
 * minute, each one finding nothing to do.
 *
 * Best effort by design: the table is per server instance and purely in memory,
 * so the worst case is a few extra passes (exactly today's behaviour), never a
 * missed order. Nothing here decides WHETHER a delivery is billed or spawned —
 * that stays in the idempotent, conflict-guarded SQL below.
 */
const MATERIALIZE_THROTTLE_MS = 60_000;
/** Bound on the throttle table so a long-lived instance can't grow unbounded. */
const THROTTLE_MAX_SCOPES = 500;
const lastRunAtByScope = new Map<string, number>();

function scopeKey(scope: MaterializeScope): string {
  if (scope.kind === 'member') return `member:${scope.accountId}`;
  if (scope.kind === 'partner') return `partner:${scope.partnerId}`;
  return 'all';
}

/** True when this scope ran inside the throttle window. */
function ranRecently(key: string, atMs: number): boolean {
  const last = lastRunAtByScope.get(key);
  return last !== undefined && atMs - last < MATERIALIZE_THROTTLE_MS;
}

/**
 * Stamp the scope BEFORE the work, not after: two console tabs arriving at the
 * same moment should not both run the sweep. A failed pass therefore waits out
 * the window like any other, which is the same "the next read retries" contract
 * the whole module already relies on.
 */
function markRun(key: string, atMs: number): void {
  if (lastRunAtByScope.size >= THROTTLE_MAX_SCOPES) {
    for (const [k, at] of lastRunAtByScope) {
      if (atMs - at >= MATERIALIZE_THROTTLE_MS) lastRunAtByScope.delete(k);
    }
    // Every entry still fresh: drop the lot rather than grow. Costs at most one
    // extra pass per scope.
    if (lastRunAtByScope.size >= THROTTLE_MAX_SCOPES) lastRunAtByScope.clear();
  }
  lastRunAtByScope.set(key, atMs);
}

/** Digital methods are the prepaid, cycle-gated rails; COD is pay-on-delivery. */
function isDigital(method: string): boolean {
  return method === 'esewa' || method === 'khalti';
}

/** Minor-unit money for push copy (paisa/cents → major). */
function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return currency === 'NPR' ? `Rs ${major.toFixed(0)}` : `$${major.toFixed(2)}`;
}

interface SubRow {
  id: string;
  accountId: string;
  partnerId: string;
  daysOfWeek: number[];
  window: MealWindow;
  planType: 'fixed_meal' | 'partner_rotating';
  mealId: string | null;
  addressId: string;
  pricePerDayMinor: number;
  currency: 'NPR' | 'USD';
  paymentMethod: 'esewa' | 'khalti' | 'cod';
  startDate: string;
}

/**
 * Count the subscribed delivery slots in a Sun–Sat week that are billable: on or
 * after `startDate`, a subscribed weekday, AND still deliverable (`now` is before
 * the slot's cutoff). Excluding already-past-cutoff slots is essential — a
 * mid-week (or post-cutoff) signup must never be billed for a day the
 * materializer can never spawn (buildMaterializationPlan applies the identical
 * `now >= cutoff` skip), which would overcharge the member for undelivered meals.
 */
function plannedSlotsFor(
  sub: SubRow,
  weekStart: string,
  startDate: string,
  now: Date,
  cfg: MealDeliveryConfig,
): number {
  let n = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = ktmAddDays(weekStart, i);
    if (d < startDate) continue;
    if (!sub.daysOfWeek.includes(ktmDayOfWeek(d))) continue;
    // Past its cutoff ⇒ can never materialize ⇒ must not be billed.
    if (now.getTime() >= cutoffFor(d, sub.window, 'Asia/Kathmandu', cfg).getTime()) continue;
    n += 1;
  }
  return n;
}

/** Map key for one (subscription, week) billing cycle. */
function cycleKey(subscriptionId: string, weekStart: string): string {
  return `${subscriptionId}|${weekStart}`;
}

/**
 * Ensure the Sun–Sat billing cycles for every (digital sub × horizon week) pair
 * exist and, if still `open`, bill them (freeze amount, flip to
 * `awaiting_payment`, push). Prepaid: the member pays this frozen amount before
 * the week's orders materialize. Returns the current {id,status} per pair; a
 * week with no billable slot for a plan is simply absent.
 *
 * THREE statements total, whatever the plan count (P0). This used to be a
 * sequential loop of insert → select → update per subscription per week, so an
 * admin pass over the whole platform cost three round trips per plan per week
 * and got slower every time someone subscribed.
 *
 * The money rules are unchanged and still enforced by the SQL, not by us:
 *  - the insert keeps its `(subscription, week_start)` conflict guard, so a
 *    racing pass can never create a second cycle or re-price an existing one;
 *  - the update is still a CAS on `status='open'`, so a cycle that is already
 *    awaiting payment, under receipt review, PAID or void is never touched;
 *  - the frozen amount is still `planned_slots × price_per_day_minor` read from
 *    the cycle ROW's own creation-time values — computed in the database now,
 *    which also closes the old read-then-write gap between the two.
 *  - only rows the update actually flipped come back from RETURNING, so exactly
 *    one "bill ready" push is sent per cycle, as before.
 */
async function ensureAndBillCycles(
  db: Db,
  digitalSubs: readonly SubRow[],
  horizonWeeks: readonly string[],
  now: Date,
  cfg: MealDeliveryConfig,
): Promise<Map<string, { id: string; status: CycleStatus }>> {
  const out = new Map<string, { id: string; status: CycleStatus }>();
  if (digitalSubs.length === 0 || horizonWeeks.length === 0) return out;

  // 1. Pure planning pass — no I/O. A week with zero billable slots is dropped
  //    here exactly as the per-cycle version returned null for it.
  const planned: { sub: SubRow; weekStart: string; weekEnd: string; plannedSlots: number }[] = [];
  for (const sub of digitalSubs) {
    for (const weekStart of horizonWeeks) {
      const plannedSlots = plannedSlotsFor(sub, weekStart, sub.startDate, now, cfg);
      if (plannedSlots === 0) continue;
      planned.push({ sub, weekStart, weekEnd: weekBoundsFor(weekStart).weekEnd, plannedSlots });
    }
  }
  if (planned.length === 0) return out;

  // 2. ONE multi-row insert; existing cycles are left completely alone.
  await db
    .insert(mealBillingCycles)
    .values(
      planned.map((p) => ({
        subscriptionId: p.sub.id,
        accountId: p.sub.accountId,
        weekStart: p.weekStart,
        weekEnd: p.weekEnd,
        plannedSlots: p.plannedSlots,
        pricePerDayMinor: p.sub.pricePerDayMinor,
        currency: p.sub.currency,
        status: 'open' as const,
        amountMinor: 0,
      })),
    )
    .onConflictDoNothing({
      target: [mealBillingCycles.subscriptionId, mealBillingCycles.weekStart],
    });

  // 3. ONE select over the same subscription ids and week bounds.
  const wanted = new Set(planned.map((p) => cycleKey(p.sub.id, p.weekStart)));
  const subIds = [...new Set(planned.map((p) => p.sub.id))];
  const weekStarts = [...new Set(planned.map((p) => p.weekStart))];
  const cycles = await db
    .select({
      id: mealBillingCycles.id,
      subscriptionId: mealBillingCycles.subscriptionId,
      weekStart: mealBillingCycles.weekStart,
      status: mealBillingCycles.status,
    })
    .from(mealBillingCycles)
    .where(
      and(
        inArray(mealBillingCycles.subscriptionId, subIds),
        inArray(mealBillingCycles.weekStart, weekStarts),
      ),
    );

  const keyByOpenId = new Map<string, string>();
  for (const cycle of cycles) {
    const key = cycleKey(cycle.subscriptionId, cycle.weekStart);
    // The select is a cross product of ids × weeks, so it can return a cycle for
    // a pair this pass did not plan (that plan has nothing left to bill this
    // week). Skipping it keeps behaviour identical to the per-cycle version.
    if (!wanted.has(key)) continue;
    out.set(key, { id: cycle.id, status: cycle.status });
    if (cycle.status === 'open') keyByOpenId.set(cycle.id, key);
  }

  const openIds = [...keyByOpenId.keys()];
  if (openIds.length === 0) return out;

  // 4. ONE update, returning only the rows that actually flipped so the push
  //    fan-out still fires once per newly billed week.
  const billed = await db
    .update(mealBillingCycles)
    .set({
      status: 'awaiting_payment',
      amountMinor: sql`${mealBillingCycles.plannedSlots} * ${mealBillingCycles.pricePerDayMinor}`,
      updatedAt: now,
    })
    .where(and(inArray(mealBillingCycles.id, openIds), eq(mealBillingCycles.status, 'open')))
    .returning({
      id: mealBillingCycles.id,
      accountId: mealBillingCycles.accountId,
      amountMinor: mealBillingCycles.amountMinor,
      currency: mealBillingCycles.currency,
    });

  // A cycle we saw open is reported as awaiting_payment whether we won the CAS
  // or a concurrent pass did — same as before, and the order gate only ever
  // spawns on 'paid' regardless.
  for (const [id, key] of keyByOpenId) out.set(key, { id, status: 'awaiting_payment' });

  for (const row of billed) {
    after(() =>
      sendPushToAccount(row.accountId, {
        title: 'Weekly meal bill ready',
        body: `Your meal plan bill of ${formatMoney(row.amountMinor, row.currency)} is ready to pay.`,
        data: { type: 'meal_cycle', cycleId: row.id },
      }),
    );
  }
  return out;
}

/**
 * Materialize due subscription orders for `scope` across the today+tomorrow KTM
 * horizon, managing weekly billing cycles first. Best-effort — logs and returns
 * on any failure so the calling read still serves existing rows.
 *
 * Repeat calls for the same scope inside {@link MATERIALIZE_THROTTLE_MS} return
 * immediately; pass `{ force: true }` from a write path that has to see its own
 * effect right away (see {@link MaterializeOptions}).
 */
export async function materializeDueOrders(
  db: Db,
  scope: MaterializeScope,
  now: Date = new Date(),
  opts?: MaterializeOptions,
): Promise<void> {
  // Wall clock, not the injected `now`: a caller pinning `now` for determinism
  // must not also pin the throttle window.
  const atMs = Date.now();
  const key = scopeKey(scope);
  const force = opts?.force ?? (scope.kind === 'member');
  if (!force) {
    if (ranRecently(key, atMs)) return;
    markRun(key, atMs);
  }
  try {
    const today = ktmDateString(now);
    const tomorrow = ktmAddDays(today, 1);
    const horizon = { today, tomorrow };

    // Server-authoritative cutoff hours (admin-editable). Both weekly billing and
    // the materialization plan resolve cutoffs from this so an operator edit to
    // meal_delivery_config takes effect uniformly.
    const cfg = await loadDeliveryConfig(db);

    const scopePredicate =
      scope.kind === 'member'
        ? eq(mealSubscriptions.accountId, scope.accountId)
        : scope.kind === 'partner'
          ? eq(mealSubscriptions.partnerId, scope.partnerId)
          : undefined;

    // Store pause is a REAL stop (P0-2). `meal_partners.acceptingOrders` (and the
    // `isActive` kill-switch) gate every other create path — one-time checkout,
    // subscription create — but subscription orders used to keep spawning into a
    // paused kitchen, and a prepaid one arrives already paid, so the partner
    // could not even refuse it. The inner join skips those subscriptions for as
    // long as the pause lasts: no new weekly bill, no new order.
    //
    // Forward-only by construction: this only decides what is CREATED from now
    // on. Nothing already materialized is cancelled or voided — orders the
    // partner accepted before pausing are still theirs to fulfil, and resuming
    // simply lets the next read spawn the remaining, still-before-cutoff slots.
    const subs = (await db
      .select({
        id: mealSubscriptions.id,
        accountId: mealSubscriptions.accountId,
        partnerId: mealSubscriptions.partnerId,
        daysOfWeek: mealSubscriptions.daysOfWeek,
        window: mealSubscriptions.window,
        planType: mealSubscriptions.planType,
        mealId: mealSubscriptions.mealId,
        addressId: mealSubscriptions.addressId,
        pricePerDayMinor: mealSubscriptions.pricePerDayMinor,
        currency: mealSubscriptions.currency,
        paymentMethod: mealSubscriptions.paymentMethod,
        startDate: mealSubscriptions.startDate,
      })
      .from(mealSubscriptions)
      .innerJoin(mealPartners, eq(mealPartners.id, mealSubscriptions.partnerId))
      .where(
        scopePredicate
          ? and(
              eq(mealSubscriptions.status, 'active'),
              eq(mealPartners.isActive, true),
              eq(mealPartners.acceptingOrders, true),
              scopePredicate,
            )
          : and(
              eq(mealSubscriptions.status, 'active'),
              eq(mealPartners.isActive, true),
              eq(mealPartners.acceptingOrders, true),
            ),
      )) as SubRow[];

    if (subs.length === 0) return;

    const subIds = subs.map((s) => s.id);
    const partnerIds = [...new Set(subs.map((s) => s.partnerId))];
    const accountIds = [...new Set(subs.map((s) => s.accountId))];
    const addressIds = [...new Set(subs.map((s) => s.addressId))];

    // --- Weekly billing cycles (digital subs only) --------------------------
    // The BILL horizon is deliberately wider than the ORDER horizon (P0-3).
    //
    // Orders still spawn only for today+tomorrow. Bills, though, used to be
    // created off that same window, so next week's cycle first appeared on
    // Saturday — while its first cutoff (Sunday lunch closes Saturday 21:00
    // KTM) was hours away or already past. The member was billed for the whole
    // week, then physically could not pay in time for the early days: they paid
    // for slots the materializer can never spawn.
    //
    // Looking a full week ahead means the bill for a week always exists before
    // that week's FIRST cutoff, so every billed slot is still payable-and-
    // deliverable when it is quoted. `today + 7` is the same weekday next week,
    // so this resolves to exactly {this week, next week} on every day —
    // no extra weeks, and the order-spawn horizon below is untouched.
    const CYCLE_HORIZON_DAYS = 7;
    const horizonWeeks = [
      ...new Set([
        weekBoundsFor(today).weekStart,
        weekBoundsFor(tomorrow).weekStart,
        weekBoundsFor(ktmAddDays(today, CYCLE_HORIZON_DAYS)).weekStart,
      ]),
    ];
    const cycleByKey = await ensureAndBillCycles(
      db,
      subs.filter((sub) => isDigital(sub.paymentMethod)),
      horizonWeeks,
      now,
      cfg,
    );

    // --- Supporting data for the spawn snapshot -----------------------------
    const skips = await db
      .select({ subscriptionId: mealSubSkips.subscriptionId, deliveryDate: mealSubSkips.deliveryDate })
      .from(mealSubSkips)
      .where(
        and(inArray(mealSubSkips.subscriptionId, subIds), inArray(mealSubSkips.deliveryDate, [today, tomorrow])),
      );
    const skipsBySub = new Map<string, string[]>();
    for (const s of skips) {
      const list = skipsBySub.get(s.subscriptionId) ?? [];
      list.push(s.deliveryDate);
      skipsBySub.set(s.subscriptionId, list);
    }

    const accountRows = await db
      .select({ id: accounts.id, displayName: accounts.displayName })
      .from(accounts)
      .where(inArray(accounts.id, accountIds));
    const nameByAccount = new Map(accountRows.map((a) => [a.id, a.displayName]));

    const addressRows = await db
      .select({
        id: savedAddresses.id,
        phone: savedAddresses.phone,
        line: savedAddresses.line,
        area: savedAddresses.area,
        lat: savedAddresses.lat,
        lng: savedAddresses.lng,
      })
      .from(savedAddresses)
      .where(inArray(savedAddresses.id, addressIds));
    const addressById = new Map(addressRows.map((a) => [a.id, a]));

    // Partner menus: active, non-deleted meals feed both fixed-plan validation
    // and rotating-plan resolution + the item snapshot.
    const mealRows = await db
      .select({
        id: meals.id,
        partnerId: meals.partnerId,
        name: meals.name,
        kcal: meals.kcal,
        proteinG: meals.proteinG,
        carbsG: meals.carbsG,
        fatG: meals.fatG,
        fiberG: meals.fiberG,
        sugarG: meals.sugarG,
        priceMinor: meals.priceMinor,
        sortOrder: meals.sortOrder,
      })
      .from(meals)
      .where(and(inArray(meals.partnerId, partnerIds), eq(meals.isActive, true), eq(meals.isDeleted, false)))
      .orderBy(asc(meals.sortOrder), asc(meals.id));
    const mealById = new Map(mealRows.map((m) => [m.id, m]));

    // Availability narrows the rotating pool to window-appropriate meals; a meal
    // with no availability rows is always-available.
    const mealIds = mealRows.map((m) => m.id);
    const availWindows = new Map<string, Set<MealWindow>>();
    if (mealIds.length > 0) {
      const availRows = await db
        .select({ mealId: mealAvailability.mealId, window: mealAvailability.window })
        .from(mealAvailability)
        .where(inArray(mealAvailability.mealId, mealIds));
      for (const a of availRows) {
        const set = availWindows.get(a.mealId) ?? new Set<MealWindow>();
        set.add(a.window);
        availWindows.set(a.mealId, set);
      }
    }

    const rotationFor = (partnerId: string, window: MealWindow): RotationMeal[] =>
      mealRows
        .filter((m) => m.partnerId === partnerId)
        .filter((m) => {
          const windows = availWindows.get(m.id);
          return !windows || windows.has(window);
        })
        .map((m) => ({ id: m.id }));

    // --- Plan + gate + spawn -------------------------------------------------
    const materializationSubs: MaterializationSub[] = subs.map((sub) => ({
      id: sub.id,
      partnerId: sub.partnerId,
      accountId: sub.accountId,
      daysOfWeek: sub.daysOfWeek,
      window: sub.window,
      planType: sub.planType,
      // A fixed meal that's been deleted/deactivated resolves to null → skipped.
      mealId: sub.planType === 'fixed_meal' ? (sub.mealId && mealById.has(sub.mealId) ? sub.mealId : null) : null,
      addressId: sub.addressId,
      pricePerDayMinor: sub.pricePerDayMinor,
      currency: sub.currency,
      startDate: sub.startDate,
      status: 'active',
      skipDates: skipsBySub.get(sub.id) ?? [],
      rotationMeals: sub.planType === 'partner_rotating' ? rotationFor(sub.partnerId, sub.window) : undefined,
    }));

    const plan = buildMaterializationPlan(materializationSubs, horizon, now, cfg);
    const subById = new Map(subs.map((s) => [s.id, s]));

    for (const planned of plan) {
      const sub = subById.get(planned.subscriptionId);
      if (!sub) continue;
      const meal = mealById.get(planned.mealId);
      const address = addressById.get(planned.addressId);
      if (!meal || !address) continue;

      // Prepaid gate: digital orders only spawn when their week's cycle is paid.
      let cycleId: string | null = null;
      let paymentStatus: 'unpaid' | 'paid' = 'unpaid';
      if (isDigital(sub.paymentMethod)) {
        const weekStart = weekBoundsFor(planned.deliveryDate).weekStart;
        const cycle = cycleByKey.get(cycleKey(sub.id, weekStart));
        if (!cycle || cycle.status !== 'paid') continue; // never cook unpaid
        cycleId = cycle.id;
        paymentStatus = 'paid';
      }

      const deliveryName = nameByAccount.get(sub.accountId) || 'Customer';
      const deliveryAddressText = [address.line, address.area].filter((p) => p && p.length > 0).join(', ');

      const inserted = await db
        .insert(mealOrders)
        .values({
          accountId: planned.accountId,
          partnerId: planned.partnerId,
          source: 'subscription',
          subscriptionId: planned.subscriptionId,
          cycleId,
          deliveryDate: planned.deliveryDate,
          window: planned.window,
          addressId: planned.addressId,
          deliveryName,
          deliveryPhone: address.phone,
          deliveryAddressText,
          // Freeze the geocoded pin from the address at spawn (null if unpinned).
          deliveryLat: address.lat,
          deliveryLng: address.lng,
          deliveryNotes: '',
          subtotalMinor: planned.pricePerDayMinor,
          deliveryFeeMinor: 0,
          smallOrderFeeMinor: 0,
          totalMinor: planned.pricePerDayMinor,
          currency: planned.currency,
          paymentMethod: sub.paymentMethod,
          paymentStatus,
          status: 'pending',
          statusVersion: 0,
          cutoffAt: planned.cutoffAt,
        })
        .onConflictDoNothing()
        .returning({ id: mealOrders.id });

      let orderId = inserted[0]?.id;
      if (!orderId) {
        // Conflict: the order row already exists. Normally its items were inserted
        // by the pass that created it, but the order+item inserts are NOT atomic
        // (neon-http has no transactions), so a crash between them can leave an
        // itemless order. Re-fetch the row and let the guarded insert below decide
        // whether a backfill is still needed — otherwise an itemless order would
        // persist forever (the plan is deterministic, so the resolved meal is
        // identical to the original).
        const [existing] = await db
          .select({ id: mealOrders.id })
          .from(mealOrders)
          .where(
            and(
              eq(mealOrders.subscriptionId, planned.subscriptionId),
              eq(mealOrders.deliveryDate, planned.deliveryDate),
              eq(mealOrders.window, planned.window),
              eq(mealOrders.source, 'subscription'),
            ),
          )
          .limit(1);
        if (!existing) continue;
        orderId = existing.id;
      }

      const macros: MealMacrosSnapshot = {
        kcal: meal.kcal,
        proteinG: meal.proteinG,
        carbsG: meal.carbsG,
        fatG: meal.fatG,
        ...(meal.fiberG != null ? { fiberG: meal.fiberG } : {}),
        ...(meal.sugarG != null ? { sugarG: meal.sugarG } : {}),
      };
      // P1-4: "has it got items?" and "insert the item" are ONE decision now.
      // The read-then-write version let two racing materializers both observe an
      // itemless order and both insert, duplicating the line. The advisory lock
      // is a separate preceding statement on purpose — READ COMMITTED only gives
      // the waiter a fresh snapshot at the START of the next statement, so the
      // conditional insert then correctly sees the winner's row.
      await db.batch([
        db.execute(mealOrderItemsLockSql(orderId)),
        db.execute(
          guardedOrderItemInsertSql({
            itemId: crypto.randomUUID(),
            orderId,
            mealId: meal.id,
            nameSnapshot: meal.name,
            priceMinorSnapshot: meal.priceMinor,
            macrosSnapshot: macros,
            qty: 1,
          }),
        ),
      ]);
    }
  } catch (err) {
    console.error('[meals] materializeDueOrders failed', err);
  }
}

// --- Dunning (Pack G) --------------------------------------------------------
// The WP-2 `cycle-dunning` cron sends the payment-overdue *notice*; the
// auto-pause *transition* below is WP-4's domain (the cron may schedule it).
// A cycle that has flipped to `receipt_submitted` (member paid, staff reviewing)
// is deliberately NOT stale — only `awaiting_payment` past its week end counts.

/** A weekly cycle whose billed week has fully elapsed while still unpaid. */
export interface StaleCycle {
  id: string;
  subscriptionId: string;
  accountId: string;
  weekEnd: string;
}

/**
 * Overdue unpaid weekly cycles (`awaiting_payment` with `weekEnd < today` KTM),
 * oldest-first, bounded. These are the dunning targets and the input the cron
 * uses to decide which subscriptions to consider for auto-pause.
 */
export async function staleAwaitingCycles(
  db: Db,
  opts?: { now?: Date; limit?: number },
): Promise<StaleCycle[]> {
  const now = opts?.now ?? new Date();
  const today = ktmDateString(now);
  const rows = await db
    .select({
      id: mealBillingCycles.id,
      subscriptionId: mealBillingCycles.subscriptionId,
      accountId: mealBillingCycles.accountId,
      weekEnd: mealBillingCycles.weekEnd,
    })
    .from(mealBillingCycles)
    .where(and(eq(mealBillingCycles.status, 'awaiting_payment'), lt(mealBillingCycles.weekEnd, today)))
    .orderBy(asc(mealBillingCycles.weekEnd))
    .limit(opts?.limit ?? 500);
  return rows.map((r) => ({
    id: r.id,
    subscriptionId: r.subscriptionId,
    accountId: r.accountId,
    weekEnd: r.weekEnd,
  }));
}

/**
 * Auto-pause a subscription that has accumulated `>= thresholdWeeks` overdue
 * unpaid cycles (default 2). Idempotent + race-safe: the subscription flip is a
 * CAS `active→paused`, and the overdue `awaiting_payment` cycles are voided so a
 * week that can never be delivered (materialization horizon is only today+
 * tomorrow) stops being payable and stops re-triggering dunning. A cycle in
 * `receipt_submitted`/`paid` is never touched (money in review / funded). Money
 * already collected is never un-moved here — refunds stay on the admin rail.
 */
export async function autoPauseIfOverdue(
  db: Db,
  subscriptionId: string,
  opts?: { now?: Date; thresholdWeeks?: number },
): Promise<{ paused: boolean; overdueWeeks: number }> {
  const now = opts?.now ?? new Date();
  const threshold = Math.max(1, opts?.thresholdWeeks ?? 2);
  const today = ktmDateString(now);

  const overdue = await db
    .select({ id: mealBillingCycles.id })
    .from(mealBillingCycles)
    .where(
      and(
        eq(mealBillingCycles.subscriptionId, subscriptionId),
        eq(mealBillingCycles.status, 'awaiting_payment'),
        lt(mealBillingCycles.weekEnd, today),
      ),
    );
  const overdueWeeks = overdue.length;
  if (overdueWeeks < threshold) return { paused: false, overdueWeeks };

  // CAS active→paused. A concurrent pause/cancel that won matches 0 rows here.
  const paused = await db
    .update(mealSubscriptions)
    .set({ status: 'paused', updatedAt: now })
    .where(and(eq(mealSubscriptions.id, subscriptionId), eq(mealSubscriptions.status, 'active')))
    .returning({ id: mealSubscriptions.id });

  // Void the elapsed unpaid cycles regardless of the CAS winner: an already-
  // paused/cancelled plan still shouldn't carry payable bills for dead weeks.
  await db
    .update(mealBillingCycles)
    .set({ status: 'void', updatedAt: now })
    .where(
      and(
        eq(mealBillingCycles.subscriptionId, subscriptionId),
        eq(mealBillingCycles.status, 'awaiting_payment'),
        lt(mealBillingCycles.weekEnd, today),
      ),
    );

  return { paused: paused.length > 0, overdueWeeks };
}
