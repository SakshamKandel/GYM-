import { mealBillingCycles, mealSubSkips, mealSubscriptions } from '@gym/db';
import {
  ktmAddDays,
  ktmDateString,
  type CycleStatus,
  type MealWindow,
} from '@gym/shared';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
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
 */

const MAX_START_DAYS = 30;
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
  const [, insertResult] = await db.batch([
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
  ]);
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

  const [sub] = await db
    .select()
    .from(mealSubscriptions)
    .where(and(eq(mealSubscriptions.id, subscriptionId), eq(mealSubscriptions.accountId, me.id)))
    .limit(1);
  if (!sub) return json({ error: 'conflict' }, 409);

  // Bootstrap: bill the first prepaid cycle (digital) / spawn due COD orders now
  // so the member immediately sees the bill or the upcoming delivery.
  await materializeDueOrders(db, { kind: 'member', accountId: me.id }, now);

  // Return the just-billed first cycle (Pack G / B3) so the client can jump
  // straight to Pay without a second round-trip. Digital → awaiting_payment;
  // COD → none (reconciles on delivery).
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

  const pendingCycle = firstCycle ? toPendingCycle(firstCycle) : null;
  const upcoming = upcomingFor(sub, new Set<string>(), today);

  return json({ subscription: serialize(sub, pendingCycle, upcoming) }, 201);
}
