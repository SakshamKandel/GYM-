import {
  mealAvailability,
  mealPartners,
  meals,
  savedAddresses,
  type Db,
} from '@gym/db';
import {
  cutoffFor,
  ktmAddDays,
  ktmDayOfWeek,
  type CycleStatus,
  type MealDeliveryConfig,
  type MealWindow,
} from '@gym/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { deliveryEligibility, deliveryEligibilityError } from '@/lib/deliveryEligibility';
import { loadDeliveryConfig } from './config';

export interface SubscriptionPlanShape {
  daysOfWeek: number[];
  window: MealWindow;
  planType: 'fixed_meal' | 'partner_rotating';
  mealId: string | null;
  addressId: string;
}

export interface SubscriptionPlanQuote {
  pricePerDayMinor: number;
  currency: 'NPR' | 'USD';
  deliveryFeeMinor: number;
}

export type SubscriptionPlanQuoteResult =
  | { ok: true; quote: SubscriptionPlanQuote }
  | { ok: false; error: string };

/**
 * Resolve a recurring plan's live, server-authoritative daily price. This is
 * shared by create, edit-preview, and edit-commit so no client-provided amount
 * can become authoritative and the preview cannot drift from the write path.
 */
export async function quoteSubscriptionPlan(params: {
  db: Db;
  accountId: string;
  partnerId: string;
  paymentMethod: 'esewa' | 'khalti' | 'cod';
  shape: SubscriptionPlanShape;
}): Promise<SubscriptionPlanQuoteResult> {
  const { db, accountId, partnerId, paymentMethod, shape } = params;

  const [partner] = await db
    .select({
      id: mealPartners.id,
      acceptsCod: mealPartners.acceptsCod,
      serviceAreas: mealPartners.serviceAreas,
      serviceLat: mealPartners.serviceLat,
      serviceLng: mealPartners.serviceLng,
      serviceRadiusKm: mealPartners.serviceRadiusKm,
    })
    .from(mealPartners)
    .where(
      and(
        eq(mealPartners.id, partnerId),
        eq(mealPartners.isActive, true),
        eq(mealPartners.acceptingOrders, true),
      ),
    )
    .limit(1);
  if (!partner) return { ok: false, error: 'partner_unavailable' };
  if (paymentMethod === 'cod' && !partner.acceptsCod) {
    return { ok: false, error: 'cod_unavailable' };
  }

  const [address] = await db
    .select({
      id: savedAddresses.id,
      area: savedAddresses.area,
      lat: savedAddresses.lat,
      lng: savedAddresses.lng,
    })
    .from(savedAddresses)
    .where(
      and(
        eq(savedAddresses.id, shape.addressId),
        eq(savedAddresses.accountId, accountId),
        eq(savedAddresses.isDeleted, false),
      ),
    )
    .limit(1);
  if (!address) return { ok: false, error: 'address_not_found' };

  const eligibilityError = deliveryEligibilityError(deliveryEligibility(partner, address));
  if (eligibilityError) return { ok: false, error: eligibilityError };

  const config = await loadDeliveryConfig(db);
  const deliveryFeeMinor = config.deliveryFeeMinor;

  if (shape.planType === 'fixed_meal') {
    if (!shape.mealId) return { ok: false, error: 'meal_required' };
    const [meal] = await db
      .select({
        id: meals.id,
        priceMinor: meals.priceMinor,
        currency: meals.currency,
      })
      .from(meals)
      .where(
        and(
          eq(meals.id, shape.mealId),
          eq(meals.partnerId, partnerId),
          eq(meals.isActive, true),
          eq(meals.isDeleted, false),
        ),
      )
      .limit(1);
    if (!meal) return { ok: false, error: 'meal_unavailable' };

    const availability = await db
      .select({
        dayOfWeek: mealAvailability.dayOfWeek,
        window: mealAvailability.window,
      })
      .from(mealAvailability)
      .where(eq(mealAvailability.mealId, meal.id));
    if (
      availability.length > 0 &&
      shape.daysOfWeek.some(
        (day) => !availability.some((slot) => slot.dayOfWeek === day && slot.window === shape.window),
      )
    ) {
      return { ok: false, error: 'meal_unavailable_for_schedule' };
    }

    return {
      ok: true,
      quote: {
        pricePerDayMinor: meal.priceMinor + deliveryFeeMinor,
        currency: meal.currency,
        deliveryFeeMinor,
      },
    };
  }

  if (shape.mealId) return { ok: false, error: 'meal_not_allowed' };

  const menu = await db
    .select({
      id: meals.id,
      priceMinor: meals.priceMinor,
      currency: meals.currency,
    })
    .from(meals)
    .where(
      and(
        eq(meals.partnerId, partnerId),
        eq(meals.isActive, true),
        eq(meals.isDeleted, false),
      ),
    );
  if (menu.length === 0) return { ok: false, error: 'no_meals' };

  const availability = await db
    .select({
      mealId: mealAvailability.mealId,
      dayOfWeek: mealAvailability.dayOfWeek,
      window: mealAvailability.window,
    })
    .from(mealAvailability)
    .where(inArray(mealAvailability.mealId, menu.map((meal) => meal.id)));
  const slotsByMeal = new Map<string, { dayOfWeek: number; window: MealWindow }[]>();
  for (const slot of availability) {
    const slots = slotsByMeal.get(slot.mealId) ?? [];
    slots.push({ dayOfWeek: slot.dayOfWeek, window: slot.window });
    slotsByMeal.set(slot.mealId, slots);
  }

  // Every selected weekday needs at least one rotating choice. A meal with no
  // availability rows is the partner's explicit "always available" default.
  for (const day of shape.daysOfWeek) {
    const hasChoice = menu.some((meal) => {
      const slots = slotsByMeal.get(meal.id) ?? [];
      return slots.length === 0 || slots.some((slot) => slot.dayOfWeek === day && slot.window === shape.window);
    });
    if (!hasChoice) return { ok: false, error: 'no_meals_for_schedule' };
  }

  const pool = menu.filter((meal) => {
    const slots = slotsByMeal.get(meal.id) ?? [];
    return slots.length === 0 || slots.some((slot) => slot.window === shape.window);
  });
  if (pool.length === 0) return { ok: false, error: 'no_meals_for_window' };

  const currencies = new Set(pool.map((meal) => meal.currency));
  if (currencies.size !== 1) return { ok: false, error: 'mixed_currency' };
  const currency = pool[0]?.currency;
  if (!currency) return { ok: false, error: 'no_meals_for_window' };

  const mean = Math.round(pool.reduce((sum, meal) => sum + meal.priceMinor, 0) / pool.length);
  return {
    ok: true,
    quote: {
      pricePerDayMinor: mean + deliveryFeeMinor,
      currency,
      deliveryFeeMinor,
    },
  };
}

export interface EditableCycle {
  id: string;
  weekStart: string;
  status: 'open' | 'awaiting_payment' | 'void';
  plannedSlots: number;
  updatedAt: Date;
}

export interface CycleAdjustment {
  id: string;
  weekStart: string;
  expectedStatus: EditableCycle['status'];
  expectedPlannedSlots: number;
  expectedUpdatedAt: Date;
  plannedSlots: number;
  nextStatus: EditableCycle['status'];
  amountMinor: number;
}

/** Reprice future unfunded weekly cycles from the edited schedule. */
export function buildSubscriptionCycleAdjustments(params: {
  cycles: EditableCycle[];
  startDate: string;
  shape: SubscriptionPlanShape;
  pricePerDayMinor: number;
  skipDates: ReadonlySet<string>;
  now: Date;
  config: MealDeliveryConfig;
}): CycleAdjustment[] {
  const { startDate, shape, pricePerDayMinor, skipDates, now, config } = params;
  return params.cycles.map((cycle) => {
    let plannedSlots = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      const date = ktmAddDays(cycle.weekStart, offset);
      if (date < startDate || skipDates.has(date)) continue;
      if (!shape.daysOfWeek.includes(ktmDayOfWeek(date))) continue;
      if (now.getTime() >= cutoffFor(date, shape.window, 'Asia/Kathmandu', config).getTime()) continue;
      plannedSlots += 1;
    }

    const nextStatus: EditableCycle['status'] =
      plannedSlots === 0 ? 'void' : cycle.status === 'awaiting_payment' ? 'awaiting_payment' : 'open';
    return {
      id: cycle.id,
      weekStart: cycle.weekStart,
      expectedStatus: cycle.status,
      expectedPlannedSlots: cycle.plannedSlots,
      expectedUpdatedAt: cycle.updatedAt,
      plannedSlots,
      nextStatus,
      amountMinor: nextStatus === 'awaiting_payment' ? plannedSlots * pricePerDayMinor : 0,
    };
  });
}

/**
 * The subscribed delivery slots for a plan across a forward window (Pack G:
 * "deliveries scheduled for …"). Pure — the caller supplies `today` (KTM) and
 * the plan shape; skips are subtracted. Bounded by `horizonDays` and `max`. Used
 * by GET /subscriptions to render the upcoming-deliveries confirmation block.
 */
export function upcomingDeliveryDates(params: {
  daysOfWeek: number[];
  window: MealWindow;
  startDate: string;
  fromDate: string;
  horizonDays: number;
  skipDates?: ReadonlySet<string>;
  max?: number;
}): { date: string; window: MealWindow }[] {
  const { daysOfWeek, window, startDate, fromDate, horizonDays } = params;
  const skips = params.skipDates ?? new Set<string>();
  const max = params.max ?? Number.POSITIVE_INFINITY;
  // Start no earlier than the plan's own start date (a not-yet-started plan
  // projects from startDate, not today).
  const anchor = fromDate >= startDate ? fromDate : startDate;
  const out: { date: string; window: MealWindow }[] = [];
  for (let offset = 0; offset <= horizonDays && out.length < max; offset += 1) {
    const date = ktmAddDays(anchor, offset);
    if (!daysOfWeek.includes(ktmDayOfWeek(date))) continue;
    if (skips.has(date)) continue;
    out.push({ date, window });
  }
  return out;
}

/**
 * Refund owed on a PAID weekly cycle when a member self-cancels/pauses mid-week
 * (Pack G proration). Pure money math — NEVER moves money (the refund still
 * flows through the admin-authoritative rail). A day is "unused" only when it is
 * strictly AFTER `today` (KTM): today's delivery and every past day are treated
 * as committed/consumed. Skipped days are excluded. The refund is
 * `unusedDays × pricePerDayMinor`, clamped into `[0, amountMinor]` so a repriced
 * or partially-consumed cycle can never over-refund (§7.2 money bounds).
 */
export function prorateUnusedPaidDays(params: {
  weekStart: string;
  daysOfWeek: number[];
  pricePerDayMinor: number;
  amountMinor: number;
  today: string;
  skipDates?: ReadonlySet<string>;
}): { unusedDays: number; refundMinor: number } {
  const skips = params.skipDates ?? new Set<string>();
  const price = Math.max(0, Math.trunc(params.pricePerDayMinor));
  const cap = Math.max(0, Math.trunc(params.amountMinor));
  let unusedDays = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = ktmAddDays(params.weekStart, i);
    if (date <= params.today) continue; // committed / consumed
    if (!params.daysOfWeek.includes(ktmDayOfWeek(date))) continue;
    if (skips.has(date)) continue;
    unusedDays += 1;
  }
  return { unusedDays, refundMinor: Math.min(unusedDays * price, cap) };
}

/** A member-facing itemized weekly-cycle invoice/receipt (Pack G). */
export interface CycleInvoice {
  cycleId: string;
  weekStart: string;
  weekEnd: string;
  plannedSlots: number;
  pricePerDayMinor: number;
  amountMinor: number;
  currency: string;
  status: CycleStatus;
}

/** Project a billing-cycle row to the stable invoice shape WP-6 renders. */
export function buildCycleInvoice(cycle: {
  id: string;
  weekStart: string;
  weekEnd: string;
  plannedSlots: number;
  pricePerDayMinor: number;
  amountMinor: number;
  currency: string;
  status: CycleStatus;
}): CycleInvoice {
  return {
    cycleId: cycle.id,
    weekStart: cycle.weekStart,
    weekEnd: cycle.weekEnd,
    plannedSlots: cycle.plannedSlots,
    pricePerDayMinor: cycle.pricePerDayMinor,
    amountMinor: cycle.amountMinor,
    currency: cycle.currency,
    status: cycle.status,
  };
}
