import { mealBillingCycles, mealSubscriptions } from '@gym/db';
import { ktmAddDays, ktmDateString } from '@gym/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  atomicSubscriptionCreateSql,
  materializeDueOrders,
  quoteSubscriptionPlan,
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
    updatedAt: s.updatedAt,
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

  return json({ subscription: serialize(sub, null) }, 201);
}
