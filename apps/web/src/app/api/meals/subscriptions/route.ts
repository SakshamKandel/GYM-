import { mealBillingCycles, mealSubSkips, mealSubscriptions } from '@gym/db';
import {
  ktmAddDays,
  ktmDateString,
  type CycleStatus,
  type MealWindow,
} from '@gym/shared';
import { and, asc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  atomicSubscriptionCreateSql,
  buildCycleInvoice,
  materializeDueOrders,
  quoteSubscriptionPlan,
  upcomingDeliveryDates,
  type CycleInvoice,
  type SubscriptionPlanShape,
} from '@/lib/meals';
import { partnerOperationLockSql } from '@/lib/partnerOperationLock';
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
 *           A repeat of the same plan within {@link DUPLICATE_WINDOW_MS} collapses
 *           back onto the first one (200 instead of 201) — see
 *           {@link collapseDuplicatePlanSql}.
 */

const MAX_START_DAYS = 30;

/**
 * How long a second identical create is read as the SAME submission rather than
 * a new plan. A recurring plan is the one thing here a member cannot double up
 * on harmlessly: two of them bill twice, every week, forever, and each one
 * spawns its own order for the same slot — so a double tap on "Start plan" used
 * to buy two dinners a day and two weekly bills.
 *
 * Wide enough to swallow a retry after a lost response, short enough that
 * someone who genuinely wants a second identical plan is never permanently
 * refused one; they just wait, or change a day.
 */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
/** How far ahead the "deliveries scheduled for …" projection looks (Pack G). */
const UPCOMING_HORIZON_DAYS = 14;
const UPCOMING_MAX = 8;

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

/**
 * The caller's oldest still-actionable weekly bill for a plan (Pack G / B5):
 * either `awaiting_payment` (Pay CTA active) or `receipt_submitted` (member has
 * uploaded a receipt, staff reviewing → the card renders "under review", NOT a
 * live Pay button). `receiptSubmitted` + `status` let the client distinguish the
 * two without inferring; `invoice` is the itemized weekly receipt. Without this
 * surface the member has no way to discover a `cycleId` to pay (the bill only
 * ever otherwise surfaces via a push that may be missed/denied), so a digital
 * subscription would silently never deliver once a cycle is billed.
 */
interface PendingCycle {
  id: string;
  weekStart: string;
  weekEnd: string;
  amountMinor: number;
  currency: string;
  status: CycleStatus;
  receiptSubmitted: boolean;
  invoice: CycleInvoice;
}

interface UpcomingDelivery {
  date: string;
  window: MealWindow;
}

function serialize(
  s: typeof mealSubscriptions.$inferSelect,
  pendingCycle: PendingCycle | null,
  upcomingDeliveries: UpcomingDelivery[],
) {
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
    updatedAt: s.updatedAt,
    pendingCycle,
    upcomingDeliveries,
  };
}

/** Forward delivery projection for one plan (active plans only; else empty). */
function upcomingFor(
  sub: Pick<
    typeof mealSubscriptions.$inferSelect,
    'daysOfWeek' | 'window' | 'startDate' | 'status'
  >,
  skipDates: ReadonlySet<string>,
  today: string,
): UpcomingDelivery[] {
  if (sub.status !== 'active') return [];
  return upcomingDeliveryDates({
    daysOfWeek: sub.daysOfWeek,
    window: sub.window,
    startDate: sub.startDate,
    fromDate: today,
    horizonDays: UPCOMING_HORIZON_DAYS,
    skipDates,
    max: UPCOMING_MAX,
  });
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const now = new Date();
  await materializeDueOrders(db, { kind: 'member', accountId: me.id }, now);

  const rows = await db
    .select()
    .from(mealSubscriptions)
    .where(eq(mealSubscriptions.accountId, me.id));

  const pendingBySub = new Map<string, PendingCycle>();
  const skipsBySub = new Map<string, Set<string>>();
  const today = ktmDateString(now);
  if (rows.length > 0) {
    const subIds = rows.map((r) => r.id);
    const cycles = await db
      .select({
        id: mealBillingCycles.id,
        subscriptionId: mealBillingCycles.subscriptionId,
        weekStart: mealBillingCycles.weekStart,
        weekEnd: mealBillingCycles.weekEnd,
        plannedSlots: mealBillingCycles.plannedSlots,
        pricePerDayMinor: mealBillingCycles.pricePerDayMinor,
        amountMinor: mealBillingCycles.amountMinor,
        currency: mealBillingCycles.currency,
        status: mealBillingCycles.status,
      })
      .from(mealBillingCycles)
      .where(
        and(
          inArray(mealBillingCycles.subscriptionId, subIds),
          // Both are "actionable/awaiting resolution": awaiting_payment (pay
          // now) and receipt_submitted (uploaded, under staff review). Paid /
          // void / open never surface as a pending bill.
          inArray(mealBillingCycles.status, ['awaiting_payment', 'receipt_submitted']),
        ),
      )
      .orderBy(asc(mealBillingCycles.weekStart));
    // Oldest actionable week first per subscription (fairness) — orderBy asc +
    // a Map that only sets-once keeps the first (earliest) match per sub.
    for (const c of cycles) {
      if (pendingBySub.has(c.subscriptionId)) continue;
      pendingBySub.set(c.subscriptionId, toPendingCycle(c));
    }

    // Skips (>= today) feed the forward delivery projection for active plans.
    const skips = await db
      .select({ subscriptionId: mealSubSkips.subscriptionId, deliveryDate: mealSubSkips.deliveryDate })
      .from(mealSubSkips)
      .where(and(inArray(mealSubSkips.subscriptionId, subIds), gte(mealSubSkips.deliveryDate, today)));
    for (const s of skips) {
      const set = skipsBySub.get(s.subscriptionId) ?? new Set<string>();
      set.add(s.deliveryDate);
      skipsBySub.set(s.subscriptionId, set);
    }
  }

  return json(
    {
      subscriptions: rows.map((r) =>
        serialize(
          r,
          pendingBySub.get(r.id) ?? null,
          upcomingFor(r, skipsBySub.get(r.id) ?? new Set<string>(), today),
        ),
      ),
    },
    200,
  );
}

interface CycleRow {
  id: string;
  weekStart: string;
  weekEnd: string;
  plannedSlots: number;
  pricePerDayMinor: number;
  amountMinor: number;
  currency: string;
  status: CycleStatus;
}

/**
 * Undo a just-inserted plan when the member already has the identical one.
 *
 * This runs as the LAST statement of the create batch, so it is inside the same
 * transaction as the insert and behind the same partner advisory lock: the row
 * it removes was never visible to anyone, nothing could have attached a billing
 * cycle or an order to it, and there is nothing to compensate afterwards. Two
 * taps racing each other both queue on the lock, so the loser's own statement
 * sees the winner's committed plan and cancels itself out.
 *
 * "Identical" is the whole creation intent — same partner, days, window, plan
 * type, meal, address and start date — compared against the inserted row itself
 * rather than re-bound parameters, so the two can never drift apart. Only an
 * ACTIVE recent twin counts: a plan the member paused or cancelled and then
 * deliberately started again is a new plan, not a repeat.
 */
function collapseDuplicatePlanSql(subscriptionId: string, createdSince: Date): SQL {
  return sql`
    delete from meal_subscriptions target
    using meal_subscriptions dup
    where target.id = ${subscriptionId}
      and dup.id <> target.id
      and dup.account_id = target.account_id
      and dup.partner_id = target.partner_id
      and dup.status = 'active'
      and dup."window" = target."window"
      and dup.plan_type = target.plan_type
      and dup.meal_id is not distinct from target.meal_id
      and dup.address_id = target.address_id
      and dup.days_of_week = target.days_of_week
      and dup.start_date = target.start_date
      and dup.created_at >= ${createdSince}
    returning dup.id as existing_id
  `;
}

function toPendingCycle(c: CycleRow): PendingCycle {
  return {
    id: c.id,
    weekStart: c.weekStart,
    weekEnd: c.weekEnd,
    amountMinor: c.amountMinor,
    currency: c.currency,
    status: c.status,
    receiptSubmitted: c.status === 'receipt_submitted',
    invoice: buildCycleInvoice(c),
  };
}

/**
 * The create response for one plan: the plan itself, its first still-payable
 * weekly bill and its forward delivery projection. Materializes first, so a
 * digital plan comes back with the cycle the member has to pay before anything
 * is cooked (Pack G / B3) instead of needing a second round-trip. Null = the
 * plan is not there (or not the caller's), which the callers report as a
 * conflict. Shared by a fresh create and by a collapsed repeat so the two can
 * never answer differently.
 */
async function loadPlanView(
  db: ReturnType<typeof getDb>,
  accountId: string,
  subscriptionId: string,
  now: Date,
  today: string,
): Promise<ReturnType<typeof serialize> | null> {
  const [sub] = await db
    .select()
    .from(mealSubscriptions)
    .where(and(eq(mealSubscriptions.id, subscriptionId), eq(mealSubscriptions.accountId, accountId)))
    .limit(1);
  if (!sub) return null;

  await materializeDueOrders(db, { kind: 'member', accountId }, now);

  const [firstCycle] = await db
    .select({
      id: mealBillingCycles.id,
      weekStart: mealBillingCycles.weekStart,
      weekEnd: mealBillingCycles.weekEnd,
      plannedSlots: mealBillingCycles.plannedSlots,
      pricePerDayMinor: mealBillingCycles.pricePerDayMinor,
      amountMinor: mealBillingCycles.amountMinor,
      currency: mealBillingCycles.currency,
      status: mealBillingCycles.status,
    })
    .from(mealBillingCycles)
    .where(
      and(
        eq(mealBillingCycles.subscriptionId, subscriptionId),
        inArray(mealBillingCycles.status, ['awaiting_payment', 'receipt_submitted']),
      ),
    )
    .orderBy(asc(mealBillingCycles.weekStart))
    .limit(1);

  return serialize(
    sub,
    firstCycle ? toPendingCycle(firstCycle) : null,
    upcomingFor(sub, new Set<string>(), today),
  );
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
  const db = getDb();
  const shape: SubscriptionPlanShape = {
    daysOfWeek,
    window,
    planType,
    mealId: planType === 'fixed_meal' ? (mealId ?? null) : null,
    addressId,
  };
  const quoted = await quoteSubscriptionPlan({
    db,
    accountId: me.id,
    partnerId,
    paymentMethod,
    shape,
  });
  if (!quoted.ok) return json({ error: quoted.error }, 400);

  const subscriptionId = crypto.randomUUID();
  const [, insertResult, collapse] = await db.batch([
    db.execute(partnerOperationLockSql(partnerId)),
    db.execute(
      atomicSubscriptionCreateSql({
        id: subscriptionId,
        accountId: me.id,
        partnerId,
        shape,
        pricePerDayMinor: quoted.quote.pricePerDayMinor,
        currency: quoted.quote.currency,
        paymentMethod,
        startDate,
      }),
    ),
    db.execute(
      collapseDuplicatePlanSql(subscriptionId, new Date(now.getTime() - DUPLICATE_WINDOW_MS)),
    ),
  ]);

  // The same plan already existed, so this request's row undid itself inside the
  // transaction. Hand back the plan the member actually has — same body, 200
  // instead of 201, exactly how the one-time order path replays a retry.
  const collapsedInto = collapse.rows[0]?.existing_id;
  if (typeof collapsedInto === 'string') {
    const view = await loadPlanView(db, me.id, collapsedInto, now, today);
    return view ? json({ subscription: view }, 200) : json({ error: 'conflict' }, 409);
  }

  const insertedId = insertResult.rows[0]?.id;
  if (insertedId !== subscriptionId) {
    // A partner/menu/address write won after the preview. Re-quote so the race
    // resolves to the most actionable current error instead of a vague 500.
    const current = await quoteSubscriptionPlan({
      db,
      accountId: me.id,
      partnerId,
      paymentMethod,
      shape,
    });
    return json({ error: current.ok ? 'conflict' : current.error }, 409);
  }

  const view = await loadPlanView(db, me.id, subscriptionId, now, today);
  if (!view) return json({ error: 'conflict' }, 409);

  return json({ subscription: view }, 201);
}
