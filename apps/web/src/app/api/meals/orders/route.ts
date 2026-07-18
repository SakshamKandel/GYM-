import {
  mealAvailability,
  mealOrderEvents,
  mealOrderItems,
  mealOrders,
  mealPartners,
  meals,
  savedAddresses,
  type MealMacrosSnapshot,
} from '@gym/db';
import {
  cutoffFor,
  isMealAvailableForDate,
  isSlotOrderable,
  ktmAddDays,
  ktmDateString,
  maskPii,
  TERMINAL_ORDER_STATUSES,
  type MealAvailabilitySlot,
} from '@gym/shared';
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  buildMemberOrderView,
  computeOrderFinancials,
  loadDeliveryConfig,
  materializeDueOrders,
  type PricedLine,
} from '@/lib/meals';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Member one-time meal orders (§3 / §8).
 *
 *  - POST {partnerId,deliveryDate,window,addressId,items,paymentMethod,notes?}
 *    The server is authoritative for EVERYTHING that touches money or time: it
 *    re-resolves each meal's price, recomputes fees from meal_delivery_config,
 *    freezes `cutoffAt` from the slot, and snapshots the delivery fields — the
 *    client cannot set any of them (invariant §8a). The slot must still be
 *    orderable (now < cutoff) and COD only when the partner accepts it.
 *  - GET ?scope=upcoming|history — materializes due subscription orders first,
 *    then returns the caller's own orders with line items.
 */

const MAX_HORIZON_DAYS = 30;

const postSchema = z.object({
  partnerId: z.string().min(1),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  window: z.enum(['lunch', 'dinner']),
  addressId: z.string().min(1),
  items: z
    .array(z.object({ mealId: z.string().min(1), qty: z.number().int().min(1).max(20) }))
    .min(1)
    .max(20),
  paymentMethod: z.enum(['esewa', 'khalti', 'cod']),
  notes: z.string().trim().max(500).optional(),
});

const getSchema = z.object({ scope: z.enum(['upcoming', 'history']).default('upcoming') });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'meals/orders',
    limit: 30,
    windowMs: 24 * 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { partnerId, deliveryDate, window, addressId, items, paymentMethod, notes } = parsed.data;

  const now = new Date();
  const today = ktmDateString(now);
  if (deliveryDate < today || deliveryDate > ktmAddDays(today, MAX_HORIZON_DAYS)) {
    return json({ error: 'out_of_range' }, 400);
  }

  const db = getDb();
  // Server-authoritative fee + cutoff config (admin-editable). Cutoff hours flow
  // into both the orderability check and the frozen `cutoffAt` below.
  const cfg = await loadDeliveryConfig(db);
  // Slot must still be open (frozen cutoff enforced here and again as cutoffAt).
  if (!isSlotOrderable(deliveryDate, window, now, cfg)) return json({ error: 'past_cutoff' }, 400);

  const [partner] = await db
    .select({ id: mealPartners.id, acceptsCod: mealPartners.acceptsCod })
    .from(mealPartners)
    .where(and(eq(mealPartners.id, partnerId), eq(mealPartners.isActive, true)))
    .limit(1);
  if (!partner) return json({ error: 'partner_unavailable' }, 400);
  if (paymentMethod === 'cod' && !partner.acceptsCod) return json({ error: 'cod_unavailable' }, 400);

  // Address must belong to the caller and be live.
  const [address] = await db
    .select({ phone: savedAddresses.phone, line: savedAddresses.line, area: savedAddresses.area })
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

  // Resolve every meal against THIS partner's live menu (server-authoritative
  // price + currency + macros). A meal that isn't this partner's, is inactive,
  // or is deleted fails the whole order.
  const mealIds = [...new Set(items.map((i) => i.mealId))];
  const mealRows = await db
    .select()
    .from(meals)
    .where(
      and(
        inArray(meals.id, mealIds),
        eq(meals.partnerId, partnerId),
        eq(meals.isActive, true),
        eq(meals.isDeleted, false),
      ),
    );
  if (mealRows.length !== mealIds.length) return json({ error: 'meal_unavailable' }, 400);
  const mealById = new Map(mealRows.map((m) => [m.id, m]));

  // All lines must share one currency (a partner's menu is single-currency).
  const currencies = new Set(mealRows.map((m) => m.currency));
  if (currencies.size !== 1) return json({ error: 'mixed_currency' }, 400);
  const currency = mealRows[0].currency;

  // Availability for the requested slot.
  const availRows = await db
    .select({ mealId: mealAvailability.mealId, dayOfWeek: mealAvailability.dayOfWeek, window: mealAvailability.window })
    .from(mealAvailability)
    .where(inArray(mealAvailability.mealId, mealIds));
  const availByMeal = new Map<string, MealAvailabilitySlot[]>();
  for (const a of availRows) {
    const list = availByMeal.get(a.mealId) ?? [];
    list.push({ dayOfWeek: a.dayOfWeek, window: a.window });
    availByMeal.set(a.mealId, list);
  }
  for (const mealId of mealIds) {
    if (!isMealAvailableForDate(availByMeal.get(mealId) ?? [], deliveryDate, window)) {
      return json({ error: 'meal_unavailable_for_slot' }, 400);
    }
  }

  const lines: PricedLine[] = items.map((i) => ({ priceMinor: mealById.get(i.mealId)!.priceMinor, qty: i.qty }));
  const financials = computeOrderFinancials(lines, cfg);
  const cutoffAt = cutoffFor(deliveryDate, window, 'Asia/Kathmandu', cfg);
  const deliveryAddressText = [address.line, address.area].filter((p) => p && p.length > 0).join(', ');

  const [order] = await db
    .insert(mealOrders)
    .values({
      accountId: me.id,
      partnerId,
      source: 'one_time',
      subscriptionId: null,
      cycleId: null,
      deliveryDate,
      window,
      addressId,
      deliveryName: me.displayName || 'Customer',
      deliveryPhone: address.phone,
      deliveryAddressText,
      deliveryNotes: notes ? maskPii(notes) : '',
      subtotalMinor: financials.subtotalMinor,
      deliveryFeeMinor: financials.deliveryFeeMinor,
      smallOrderFeeMinor: financials.smallOrderFeeMinor,
      totalMinor: financials.totalMinor,
      currency,
      paymentMethod,
      paymentStatus: 'unpaid',
      status: 'pending',
      statusVersion: 0,
      cutoffAt,
    })
    .returning();

  const itemValues = items.map((i) => {
    const meal = mealById.get(i.mealId)!;
    const macros: MealMacrosSnapshot = {
      kcal: meal.kcal,
      proteinG: meal.proteinG,
      carbsG: meal.carbsG,
      fatG: meal.fatG,
      ...(meal.fiberG != null ? { fiberG: meal.fiberG } : {}),
      ...(meal.sugarG != null ? { sugarG: meal.sugarG } : {}),
    };
    return {
      orderId: order.id,
      mealId: meal.id,
      nameSnapshot: meal.name,
      priceMinorSnapshot: meal.priceMinor,
      macrosSnapshot: macros,
      qty: i.qty,
    };
  });
  const insertedItems = await db.insert(mealOrderItems).values(itemValues).returning();

  // Creation audit (best-effort — never undoes the committed order).
  try {
    await db.insert(mealOrderEvents).values({
      orderId: order.id,
      fromStatus: null,
      toStatus: 'pending',
      actorId: me.id,
      actorRole: 'member',
    });
  } catch (err) {
    console.error('[meals] order creation event append failed', err);
  }

  return json({ order: buildMemberOrderView(order, insertedItems) }, 201);
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const parsed = getSchema.safeParse({ scope: url.searchParams.get('scope') ?? undefined });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { scope } = parsed.data;

  const db = getDb();
  // Spawn any due subscription orders for this member before reading.
  await materializeDueOrders(db, { kind: 'member', accountId: me.id });

  const terminal = [...TERMINAL_ORDER_STATUSES];
  const statusPredicate =
    scope === 'history'
      ? inArray(mealOrders.status, terminal)
      : notInArray(mealOrders.status, terminal);

  const orders = await db
    .select()
    .from(mealOrders)
    .where(and(eq(mealOrders.accountId, me.id), statusPredicate))
    .orderBy(scope === 'history' ? desc(mealOrders.placedAt) : asc(mealOrders.cutoffAt));

  if (orders.length === 0) return json({ orders: [] }, 200);

  const orderIds = orders.map((o) => o.id);
  const itemRows = await db
    .select()
    .from(mealOrderItems)
    .where(inArray(mealOrderItems.orderId, orderIds));
  const itemsByOrder = new Map<string, (typeof itemRows)[number][]>();
  for (const it of itemRows) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    list.push(it);
    itemsByOrder.set(it.orderId, list);
  }

  return json(
    { orders: orders.map((o) => buildMemberOrderView(o, itemsByOrder.get(o.id) ?? [])) },
    200,
  );
}
