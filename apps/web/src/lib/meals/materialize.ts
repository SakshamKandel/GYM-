import {
  accounts,
  mealAvailability,
  mealBillingCycles,
  mealOrderItems,
  mealOrders,
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
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { sendPushToAccount } from '@/lib/push';
import { loadDeliveryConfig } from './config';

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
 *  - Horizon is STRICTLY today + tomorrow (KTM); the past never retro-spawns
 *    (§8e).
 *  - Snapshot: address (name/phone/text) + the day's price are frozen onto the
 *    row at spawn and never re-resolved (§8a).
 *  - Prepaid billing: for DIGITAL (eSewa/Khalti) subscriptions a delivery date is
 *    materialized only when the Sun–Sat cycle covering it is `paid` — "never cook
 *    unpaid". COD subscriptions have no cycle gate (reconciled on delivery).
 *
 * Never throws: materialization is a best-effort side effect of a read, so a
 * transient failure logs and the route still serves whatever already exists
 * (the next read retries the spawn).
 */

export type MaterializeScope =
  | { kind: 'member'; accountId: string }
  | { kind: 'partner'; partnerId: string }
  | { kind: 'all' };

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

/**
 * Ensure the Sun–Sat billing cycle for `(sub, weekStart)` exists and, if still
 * `open`, bill it (freeze amount, flip to `awaiting_payment`, push). Prepaid:
 * the member pays this frozen amount before the week's orders materialize.
 * Returns the current cycle {id,status} or null when the week has no slots.
 */
async function ensureAndBillCycle(
  db: Db,
  sub: SubRow,
  weekStart: string,
  now: Date,
  cfg: MealDeliveryConfig,
): Promise<{ id: string; status: CycleStatus } | null> {
  const { weekEnd } = weekBoundsFor(weekStart);
  const plannedSlots = plannedSlotsFor(sub, weekStart, sub.startDate, now, cfg);
  if (plannedSlots === 0) return null;

  await db
    .insert(mealBillingCycles)
    .values({
      subscriptionId: sub.id,
      accountId: sub.accountId,
      weekStart,
      weekEnd,
      plannedSlots,
      pricePerDayMinor: sub.pricePerDayMinor,
      currency: sub.currency,
      status: 'open',
      amountMinor: 0,
    })
    .onConflictDoNothing({
      target: [mealBillingCycles.subscriptionId, mealBillingCycles.weekStart],
    });

  const [cycle] = await db
    .select({
      id: mealBillingCycles.id,
      status: mealBillingCycles.status,
      plannedSlots: mealBillingCycles.plannedSlots,
      pricePerDayMinor: mealBillingCycles.pricePerDayMinor,
      currency: mealBillingCycles.currency,
    })
    .from(mealBillingCycles)
    .where(
      and(
        eq(mealBillingCycles.subscriptionId, sub.id),
        eq(mealBillingCycles.weekStart, weekStart),
      ),
    )
    .limit(1);
  if (!cycle) return null;

  if (cycle.status !== 'open') {
    return { id: cycle.id, status: cycle.status };
  }

  // Bill: CAS open→awaiting_payment, freezing the amount from the row's own
  // (creation-time) planned slots × price. A concurrent reader racing the same
  // flip matches 0 rows and simply observes the already-billed cycle next read.
  const amountMinor = cycle.plannedSlots * cycle.pricePerDayMinor;
  const billed = await db
    .update(mealBillingCycles)
    .set({ status: 'awaiting_payment', amountMinor, updatedAt: now })
    .where(and(eq(mealBillingCycles.id, cycle.id), eq(mealBillingCycles.status, 'open')))
    .returning({ id: mealBillingCycles.id });

  if (billed.length > 0) {
    after(() =>
      sendPushToAccount(sub.accountId, {
        title: 'Weekly meal bill ready',
        body: `Your meal plan bill of ${formatMoney(amountMinor, cycle.currency)} is ready to pay.`,
        data: { type: 'meal_cycle', cycleId: cycle.id },
      }),
    );
  }
  return { id: cycle.id, status: 'awaiting_payment' };
}

/**
 * Materialize due subscription orders for `scope` across the today+tomorrow KTM
 * horizon, managing weekly billing cycles first. Best-effort — logs and returns
 * on any failure so the calling read still serves existing rows.
 */
export async function materializeDueOrders(
  db: Db,
  scope: MaterializeScope,
  now: Date = new Date(),
): Promise<void> {
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
      .where(
        scopePredicate
          ? and(eq(mealSubscriptions.status, 'active'), scopePredicate)
          : eq(mealSubscriptions.status, 'active'),
      )) as SubRow[];

    if (subs.length === 0) return;

    const subIds = subs.map((s) => s.id);
    const partnerIds = [...new Set(subs.map((s) => s.partnerId))];
    const accountIds = [...new Set(subs.map((s) => s.accountId))];
    const addressIds = [...new Set(subs.map((s) => s.addressId))];

    // --- Weekly billing cycles (digital subs only) --------------------------
    // The two horizon dates span at most two distinct Sun–Sat weeks.
    const horizonWeeks = [...new Set([weekBoundsFor(today).weekStart, weekBoundsFor(tomorrow).weekStart])];
    const cycleByKey = new Map<string, { id: string; status: CycleStatus }>();
    for (const sub of subs) {
      if (!isDigital(sub.paymentMethod)) continue;
      for (const weekStart of horizonWeeks) {
        const cycle = await ensureAndBillCycle(db, sub, weekStart, now, cfg);
        if (cycle) cycleByKey.set(`${sub.id}|${weekStart}`, cycle);
      }
    }

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
        const cycle = cycleByKey.get(`${sub.id}|${weekStart}`);
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
        // itemless order. Re-fetch the row and backfill items iff none exist —
        // otherwise this itemless order would persist forever (the plan is
        // deterministic, so the resolved meal is identical to the original).
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
        const [item] = await db
          .select({ id: mealOrderItems.id })
          .from(mealOrderItems)
          .where(eq(mealOrderItems.orderId, existing.id))
          .limit(1);
        if (item) continue; // already has items — true no-op.
        orderId = existing.id; // itemless order → fall through to backfill.
      }

      const macros: MealMacrosSnapshot = {
        kcal: meal.kcal,
        proteinG: meal.proteinG,
        carbsG: meal.carbsG,
        fatG: meal.fatG,
        ...(meal.fiberG != null ? { fiberG: meal.fiberG } : {}),
        ...(meal.sugarG != null ? { sugarG: meal.sugarG } : {}),
      };
      await db.insert(mealOrderItems).values({
        orderId,
        mealId: meal.id,
        nameSnapshot: meal.name,
        priceMinorSnapshot: meal.priceMinor,
        macrosSnapshot: macros,
        qty: 1,
      });
    }
  } catch (err) {
    console.error('[meals] materializeDueOrders failed', err);
  }
}
