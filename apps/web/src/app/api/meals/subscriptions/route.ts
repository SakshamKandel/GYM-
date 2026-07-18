import { mealAvailability, mealBillingCycles, mealPartners, meals, mealSubscriptions, savedAddresses } from '@gym/db';
import { ktmAddDays, ktmDateString, type MealWindow } from '@gym/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { loadDeliveryConfig, materializeDueOrders } from '@/lib/meals';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Member meal subscriptions (§3 / §8).
 *
 *  - GET  → the caller's subscriptions (all statuses). Materializes + bills
 *           cycles first so a freshly-due weekly bill shows up.
 *  - POST → create a recurring plan. `pricePerDayMinor` is SERVER-computed and
 *           snapshotted (fixed = the meal's price; rotating = the mean of the
 *           partner's window meals) with the flat delivery fee folded in — the
 *           client never sets price (invariant §8a). Materialization then spawns
 *           the daily orders on read; digital plans are prepaid per weekly cycle.
 */

const MAX_START_DAYS = 30;

const createSchema = z.object({
  partnerId: z.string().min(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  window: z.enum(['lunch', 'dinner']),
  planType: z.enum(['fixed_meal', 'partner_rotating']),
  mealId: z.string().min(1).optional(),
  addressId: z.string().min(1),
  paymentMethod: z.enum(['esewa', 'khalti', 'cod']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export function OPTIONS() {
  return preflight();
}

interface PendingCycle {
  id: string;
  weekStart: string;
  weekEnd: string;
  amountMinor: number;
  currency: string;
}

/** Additive field (§8 contract is unaffected — mobile parses it leniently):
 * the caller's oldest still-unpaid weekly bill for this plan, if any. Without
 * this the member has no way to discover a `cycleId` to pay (the bill only
 * ever surfaces via a push notification, which may be missed/denied), so
 * their digital subscription silently never delivers once a cycle is billed. */
function serialize(s: typeof mealSubscriptions.$inferSelect, pendingCycle: PendingCycle | null) {
  return {
    id: s.id,
    partnerId: s.partnerId,
    daysOfWeek: s.daysOfWeek,
    window: s.window,
    planType: s.planType,
    mealId: s.mealId,
    addressId: s.addressId,
    pricePerDayMinor: s.pricePerDayMinor,
    currency: s.currency,
    paymentMethod: s.paymentMethod,
    startDate: s.startDate,
    status: s.status,
    createdAt: s.createdAt,
    pendingCycle,
  };
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  await materializeDueOrders(db, { kind: 'member', accountId: me.id });

  const rows = await db
    .select()
    .from(mealSubscriptions)
    .where(eq(mealSubscriptions.accountId, me.id));

  const pendingBySub = new Map<string, PendingCycle>();
  if (rows.length > 0) {
    const cycles = await db
      .select({
        id: mealBillingCycles.id,
        subscriptionId: mealBillingCycles.subscriptionId,
        weekStart: mealBillingCycles.weekStart,
        weekEnd: mealBillingCycles.weekEnd,
        amountMinor: mealBillingCycles.amountMinor,
        currency: mealBillingCycles.currency,
      })
      .from(mealBillingCycles)
      .where(
        and(
          inArray(
            mealBillingCycles.subscriptionId,
            rows.map((r) => r.id),
          ),
          eq(mealBillingCycles.status, 'awaiting_payment'),
        ),
      )
      .orderBy(asc(mealBillingCycles.weekStart));
    // Oldest unpaid week first per subscription (fairness) — orderBy asc + a
    // Map that only sets-once keeps the first (earliest) match per sub.
    for (const c of cycles) {
      if (pendingBySub.has(c.subscriptionId)) continue;
      pendingBySub.set(c.subscriptionId, {
        id: c.id,
        weekStart: c.weekStart,
        weekEnd: c.weekEnd,
        amountMinor: c.amountMinor,
        currency: c.currency,
      });
    }
  }

  return json({ subscriptions: rows.map((r) => serialize(r, pendingBySub.get(r.id) ?? null)) }, 200);
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'meals/subscriptions',
    limit: 20,
    windowMs: 24 * 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { partnerId, window, planType, mealId, addressId, paymentMethod, startDate } = parsed.data;
  const daysOfWeek = [...new Set(parsed.data.daysOfWeek)].sort((a, b) => a - b);

  const now = new Date();
  const today = ktmDateString(now);
  if (startDate < today || startDate > ktmAddDays(today, MAX_START_DAYS)) {
    return json({ error: 'start_out_of_range' }, 400);
  }
  if (planType === 'fixed_meal' && !mealId) return json({ error: 'meal_required' }, 400);
  if (planType === 'partner_rotating' && mealId) return json({ error: 'meal_not_allowed' }, 400);

  const db = getDb();

  const [partner] = await db
    .select({ id: mealPartners.id, acceptsCod: mealPartners.acceptsCod })
    .from(mealPartners)
    .where(and(eq(mealPartners.id, partnerId), eq(mealPartners.isActive, true)))
    .limit(1);
  if (!partner) return json({ error: 'partner_unavailable' }, 400);
  if (paymentMethod === 'cod' && !partner.acceptsCod) return json({ error: 'cod_unavailable' }, 400);

  const [address] = await db
    .select({ id: savedAddresses.id })
    .from(savedAddresses)
    .where(
      and(
        eq(savedAddresses.id, addressId),
        eq(savedAddresses.accountId, me.id),
        eq(savedAddresses.isDeleted, false),
      ),
    )
    .limit(1);
  if (!address) return json({ error: 'address_not_found' }, 400);

  const cfg = await loadDeliveryConfig(db);
  const fold = cfg.deliveryFeeMinor; // delivery folded into the daily price.

  // Resolve the snapshot price + currency from the partner's live menu.
  let pricePerDayMinor: number;
  let currency: 'NPR' | 'USD';

  if (planType === 'fixed_meal') {
    const [meal] = await db
      .select()
      .from(meals)
      .where(
        and(
          eq(meals.id, mealId!),
          eq(meals.partnerId, partnerId),
          eq(meals.isActive, true),
          eq(meals.isDeleted, false),
        ),
      )
      .limit(1);
    if (!meal) return json({ error: 'meal_unavailable' }, 400);

    // The chosen meal must be offered at the chosen window (if it narrows).
    const avail = await db
      .select({ window: mealAvailability.window })
      .from(mealAvailability)
      .where(eq(mealAvailability.mealId, meal.id));
    if (avail.length > 0 && !avail.some((a) => a.window === window)) {
      return json({ error: 'meal_unavailable_for_window' }, 400);
    }

    pricePerDayMinor = meal.priceMinor + fold;
    currency = meal.currency;
  } else {
    // Rotating: the pool is the partner's active window-appropriate meals.
    const menu = await db
      .select({
        id: meals.id,
        priceMinor: meals.priceMinor,
        currency: meals.currency,
      })
      .from(meals)
      .where(and(eq(meals.partnerId, partnerId), eq(meals.isActive, true), eq(meals.isDeleted, false)));
    if (menu.length === 0) return json({ error: 'no_meals' }, 400);

    const menuIds = menu.map((m) => m.id);
    const avail = await db
      .select({ mealId: mealAvailability.mealId, window: mealAvailability.window })
      .from(mealAvailability)
      .where(inArray(mealAvailability.mealId, menuIds));
    const windowsByMeal = new Map<string, Set<MealWindow>>();
    for (const a of avail) {
      const set = windowsByMeal.get(a.mealId) ?? new Set<MealWindow>();
      set.add(a.window);
      windowsByMeal.set(a.mealId, set);
    }
    const pool = menu.filter((m) => {
      const w = windowsByMeal.get(m.id);
      return !w || w.has(window);
    });
    if (pool.length === 0) return json({ error: 'no_meals_for_window' }, 400);

    const currencies = new Set(pool.map((m) => m.currency));
    if (currencies.size !== 1) return json({ error: 'mixed_currency' }, 400);
    currency = pool[0].currency;
    const mean = Math.round(pool.reduce((sum, m) => sum + m.priceMinor, 0) / pool.length);
    pricePerDayMinor = mean + fold;
  }

  const [sub] = await db
    .insert(mealSubscriptions)
    .values({
      accountId: me.id,
      partnerId,
      daysOfWeek,
      window,
      planType,
      mealId: planType === 'fixed_meal' ? mealId! : null,
      addressId,
      pricePerDayMinor,
      currency,
      paymentMethod,
      startDate,
      status: 'active',
    })
    .returning();

  // Bootstrap: bill the first prepaid cycle (digital) / spawn due COD orders now
  // so the member immediately sees the bill or the upcoming delivery.
  await materializeDueOrders(db, { kind: 'member', accountId: me.id }, now);

  return json({ subscription: serialize(sub, null) }, 201);
}
