import { accounts, mealBillingCycles, mealPartners, mealOrders, mealSubscriptions, meals } from '@gym/db';
import { canAdvanceSubscription, ktmDateString, subscriptionActionTarget } from '@gym/shared';
import { and, desc, eq, gt, gte, inArray } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — the meal-subscription roster (WP-11 / P0-11 admin half).
 * Before this route, admin/ops had NO way to inspect an individual member's
 * meal subscription or its billing-cycle state (only order-fulfillment
 * override + the payment-request queue existed) — this is a NEW, admin-authed
 * surface, deliberately NOT the member-authed `/api/meals/subscriptions/[id]`
 * (that route scopes every mutation to `me.id`; an admin acts on ANY account).
 * Reuses `payments.review` — no new permission key.
 *
 *  GET  `?status=active|paused|cancelled&q=<search>` → roster rows, newest
 *  subscription first, joined to the member/partner/meal + the most recent
 *  billing cycle (if any).
 *
 *  POST `{id, action:'pause'|'resume'|'cancel', reason?}` → admin-driven
 *  lifecycle transition. Mirrors the member route's CAS + cancel-cascade
 *  (void any live future orders + open/awaiting_payment billing cycles) so a
 *  cancelled plan never delivers and never bills again, whichever side
 *  triggers it.
 */

const ROSTER_CAP = 500;
const STATUSES = ['active', 'paused', 'cancelled'] as const;

const actionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['pause', 'resume', 'cancel']),
  reason: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'payments.review');
  if (principal instanceof Response) return principal;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const status = (STATUSES as readonly string[]).includes(statusParam ?? '')
    ? (statusParam as (typeof STATUSES)[number])
    : undefined;
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  const db = getDb();
  const rows = await db
    .select({
      id: mealSubscriptions.id,
      accountId: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      partnerId: mealPartners.id,
      partnerName: mealPartners.name,
      daysOfWeek: mealSubscriptions.daysOfWeek,
      window: mealSubscriptions.window,
      planType: mealSubscriptions.planType,
      mealName: meals.name,
      pricePerDayMinor: mealSubscriptions.pricePerDayMinor,
      currency: mealSubscriptions.currency,
      paymentMethod: mealSubscriptions.paymentMethod,
      startDate: mealSubscriptions.startDate,
      status: mealSubscriptions.status,
      createdAt: mealSubscriptions.createdAt,
    })
    .from(mealSubscriptions)
    .innerJoin(accounts, eq(accounts.id, mealSubscriptions.accountId))
    .innerJoin(mealPartners, eq(mealPartners.id, mealSubscriptions.partnerId))
    .leftJoin(meals, eq(meals.id, mealSubscriptions.mealId))
    .where(status ? eq(mealSubscriptions.status, status) : undefined)
    .orderBy(desc(mealSubscriptions.createdAt))
    .limit(ROSTER_CAP);

  const filtered = q
    ? rows.filter(
        (r) => r.email.toLowerCase().includes(q) || r.displayName.toLowerCase().includes(q),
      )
    : rows;

  // Most recent billing cycle per subscription (roster is capped, so one
  // extra query beats a per-row round trip / a window-function query).
  const subIds = filtered.map((r) => r.id);
  const cycleRows = subIds.length
    ? await db
        .select({
          subscriptionId: mealBillingCycles.subscriptionId,
          weekStart: mealBillingCycles.weekStart,
          weekEnd: mealBillingCycles.weekEnd,
          amountMinor: mealBillingCycles.amountMinor,
          status: mealBillingCycles.status,
        })
        .from(mealBillingCycles)
        .where(inArray(mealBillingCycles.subscriptionId, subIds))
        .orderBy(desc(mealBillingCycles.weekStart))
    : [];
  const latestCycle = new Map<string, (typeof cycleRows)[number]>();
  for (const c of cycleRows) {
    if (!latestCycle.has(c.subscriptionId)) latestCycle.set(c.subscriptionId, c);
  }

  const subscriptions = filtered.map((r) => {
    const cycle = latestCycle.get(r.id) ?? null;
    return {
      id: r.id,
      account: { id: r.accountId, email: r.email, displayName: r.displayName },
      partner: { id: r.partnerId, name: r.partnerName },
      daysOfWeek: r.daysOfWeek,
      window: r.window,
      planType: r.planType,
      mealName: r.mealName,
      pricePerDayMinor: r.pricePerDayMinor,
      currency: r.currency,
      paymentMethod: r.paymentMethod,
      startDate: r.startDate,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      currentCycle: cycle
        ? {
            weekStart: cycle.weekStart,
            weekEnd: cycle.weekEnd,
            amountMinor: cycle.amountMinor,
            status: cycle.status,
          }
        : null,
    };
  });

  return json({ subscriptions }, 200);
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'payments.review');
  if (principal instanceof Response) return principal;

  const parsed = actionSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { id, action, reason } = parsed.data;

  const db = getDb();
  const ip = clientIp(req);

  const [sub] = await db
    .select({ id: mealSubscriptions.id, accountId: mealSubscriptions.accountId, status: mealSubscriptions.status })
    .from(mealSubscriptions)
    .where(eq(mealSubscriptions.id, id))
    .limit(1);
  if (!sub) return json({ error: 'not_found' }, 404);

  const target = subscriptionActionTarget(action);
  if (!canAdvanceSubscription(sub.status as 'active' | 'paused' | 'cancelled', target)) {
    return json({ error: 'invalid_transition' }, 409);
  }

  const updated = await db
    .update(mealSubscriptions)
    .set({ status: target, updatedAt: new Date() })
    .where(and(eq(mealSubscriptions.id, sub.id), eq(mealSubscriptions.status, sub.status)))
    .returning({ id: mealSubscriptions.id, status: mealSubscriptions.status });
  const row = updated[0];
  if (!row) return json({ error: 'conflict' }, 409);

  if (target === 'cancelled') {
    const today = ktmDateString(new Date());
    await db
      .update(mealOrders)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Subscription cancelled by admin' })
      .where(
        and(
          eq(mealOrders.subscriptionId, sub.id),
          eq(mealOrders.status, 'pending'),
          gte(mealOrders.deliveryDate, today),
          gt(mealOrders.cutoffAt, new Date()),
        ),
      );

    await db
      .update(mealBillingCycles)
      .set({ status: 'void', updatedAt: new Date() })
      .where(
        and(
          eq(mealBillingCycles.subscriptionId, sub.id),
          inArray(mealBillingCycles.status, ['open', 'awaiting_payment']),
        ),
      );
  }

  await logAudit(
    principal,
    `meal_subscription.${action}`,
    'meal_subscription',
    sub.id,
    { accountId: sub.accountId, reason },
    ip,
  );

  after(() =>
    sendPushToAccount(sub.accountId, {
      title: 'Meal plan updated',
      body:
        target === 'cancelled'
          ? 'Your meal subscription was cancelled by support.'
          : target === 'paused'
            ? 'Your meal subscription was paused by support.'
            : 'Your meal subscription was resumed by support.',
      data: { type: 'meal_subscription_updated' },
    }),
  );

  return json({ subscription: { id: row.id, status: row.status } }, 200);
}
