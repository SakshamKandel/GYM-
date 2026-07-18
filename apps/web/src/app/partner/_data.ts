import 'server-only';

import {
  mealAvailability,
  mealOrderEvents,
  mealOrderItems,
  mealOrders,
  meals,
  mealSubscriptions,
  type Db,
} from '@gym/db';
import {
  TERMINAL_ORDER_STATUSES,
  type MealCurrency,
  type MealDietType,
  type MealGoalTag,
  type MealPaymentMethod,
  type MealWindow,
  type OrderStatus,
} from '@gym/shared';
import { and, asc, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import type { Principal } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { buildPartnerOrderView } from '@/lib/meals';
import { staffFromCookie } from '@/lib/staffSession';
import { mealPartners } from '@gym/db';

/**
 * Server-only data layer for the partner portal (P5). Every read here is scoped
 * by a `partnerId` that MUST come from {@link requirePartnerPage} (which resolves
 * it from the session, never from a URL/param) — mirroring the `requirePartner`
 * API guard so one restaurant can never read another's rows (§2 isolation).
 *
 * The order projections funnel through the SAME `buildPartnerOrderView`
 * chokepoint the API routes use, so the member's accountId / email / tier are
 * never serialized into a partner surface. Dates are pre-serialized to ISO
 * strings so a page can hand these straight to a client component.
 */

/** Serializable strict partner order projection (§2). No member identity. */
export interface PartnerOrderView {
  orderId: string;
  status: OrderStatus;
  placedAt: string;
  deliveryDate: string;
  window: MealWindow;
  deliveryName: string;
  deliveryPhone: string;
  deliveryAddressText: string;
  deliveryNotes: string;
  items: { name: string; qty: number; priceMinorSnapshot: number }[];
  totalMinor: number;
  currency: MealCurrency;
  paymentMethod: MealPaymentMethod;
  paymentStatus: string;
}

type OrderRow = typeof mealOrders.$inferSelect;
type ItemRow = typeof mealOrderItems.$inferSelect;

/** Wrap the shared projection and serialize its one Date field for the client. */
export function serializePartnerOrder(order: OrderRow, items: readonly ItemRow[]): PartnerOrderView {
  const v = buildPartnerOrderView(order, items);
  return { ...v, placedAt: v.placedAt.toISOString() };
}

/** A partner's own menu item, with its availability slots, for the CRUD grid. */
export interface PartnerMenuItem {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  dietType: MealDietType;
  goalTags: MealGoalTag[];
  priceMinor: number;
  currency: MealCurrency;
  isActive: boolean;
  sortOrder: number;
  availability: { dayOfWeek: number; window: MealWindow }[];
}

/** The resolved partner-portal context for a server component. */
export interface PartnerContext {
  principal: Principal;
  partnerId: string;
  partnerName: string;
  currency: string;
}

/**
 * Server-component guard for every partner page. Resolves the `gt_staff` cookie
 * to a Principal, requires role === 'partner', and looks up the caller's ACTIVE
 * `meal_partners` row by accountId (the UNIQUE login identity). Redirects — never
 * returns — on any failure so a page body only ever runs for a live partner.
 *
 * Mirrors {@link requirePartner} (the API guard) for the SSR surface: the layout
 * already bounces non-partners, but this re-checks `isActive` on every page load
 * so a mid-session deactivation can't keep serving data.
 */
export async function requirePartnerPage(): Promise<PartnerContext> {
  const principal = await staffFromCookie();
  if (!principal) redirect('/partner/login');
  if (principal.role !== 'partner') redirect(principal.role === 'coach' ? '/coach' : '/admin');

  const rows = await getDb()
    .select({
      id: mealPartners.id,
      isActive: mealPartners.isActive,
      name: mealPartners.name,
      currency: mealPartners.currency,
    })
    .from(mealPartners)
    .where(eq(mealPartners.accountId, principal.id))
    .limit(1);
  const row = rows[0];
  if (!row || !row.isActive) redirect('/partner/login');

  return { principal, partnerId: row.id, partnerName: row.name, currency: row.currency };
}

/** Load line items for a set of order ids, grouped by orderId. */
async function itemsByOrder(db: Db, orderIds: string[]): Promise<Map<string, ItemRow[]>> {
  const map = new Map<string, ItemRow[]>();
  if (orderIds.length === 0) return map;
  const rows = await db
    .select()
    .from(mealOrderItems)
    .where(inArray(mealOrderItems.orderId, orderIds));
  for (const it of rows) {
    const list = map.get(it.orderId) ?? [];
    list.push(it);
    map.set(it.orderId, list);
  }
  return map;
}

/**
 * Active (non-terminal) orders for the partner, oldest-cutoff first (the queue
 * the kitchen works top-down). Optionally narrowed to `source` — the
 * Subscriptions page passes 'subscription' for the fulfillment view.
 */
export async function loadActiveOrders(
  db: Db,
  partnerId: string,
  opts: { source?: 'one_time' | 'subscription' } = {},
): Promise<PartnerOrderView[]> {
  const terminal = [...TERMINAL_ORDER_STATUSES];
  const predicates = [eq(mealOrders.partnerId, partnerId), notInArray(mealOrders.status, terminal)];
  if (opts.source) predicates.push(eq(mealOrders.source, opts.source));

  const orders = await db
    .select()
    .from(mealOrders)
    .where(and(...predicates))
    .orderBy(asc(mealOrders.cutoffAt))
    .limit(500);
  if (orders.length === 0) return [];
  const items = await itemsByOrder(db, orders.map((o) => o.id));
  return orders.map((o) => serializePartnerOrder(o, items.get(o.id) ?? []));
}

/** One status-transition event in an order's append-only timeline (partner-safe). */
export interface PartnerOrderEvent {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorRole: string | null;
  createdAt: string;
}

/** A single order plus its full transition timeline, for the detail drawer. */
export interface PartnerOrderDetail extends PartnerOrderView {
  timeline: PartnerOrderEvent[];
}

/**
 * Load ONE order in the strict partner projection plus its transition timeline,
 * scoped to the caller's own partnerId. A foreign / missing id resolves to null
 * (the route maps that to a 404 — no cross-restaurant read, no IDOR oracle).
 */
export async function loadOrderDetail(
  db: Db,
  partnerId: string,
  orderId: string,
): Promise<PartnerOrderDetail | null> {
  const [order] = await db
    .select()
    .from(mealOrders)
    .where(and(eq(mealOrders.id, orderId), eq(mealOrders.partnerId, partnerId)))
    .limit(1);
  if (!order) return null;

  const [items, events] = await Promise.all([
    db.select().from(mealOrderItems).where(eq(mealOrderItems.orderId, orderId)),
    db
      .select({
        fromStatus: mealOrderEvents.fromStatus,
        toStatus: mealOrderEvents.toStatus,
        actorRole: mealOrderEvents.actorRole,
        createdAt: mealOrderEvents.createdAt,
      })
      .from(mealOrderEvents)
      .where(eq(mealOrderEvents.orderId, orderId))
      .orderBy(asc(mealOrderEvents.createdAt)),
  ]);

  return {
    ...serializePartnerOrder(order, items),
    timeline: events.map((e) => ({
      fromStatus: e.fromStatus as OrderStatus | null,
      toStatus: e.toStatus as OrderStatus,
      actorRole: e.actorRole,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/**
 * Store accepting-orders state, DERIVED without a schema change (the geo wave
 * owns the meal_partners columns). A partner is "paused" when it has ≥1
 * non-deleted menu item and EVERY one is inactive — the exact condition under
 * which the member order-create route already rejects every line
 * (`meals.isActive = true` is required). Pause/resume is a bulk `meals.isActive`
 * sweep (see /api/partner/store), so this predicate reads that same signal back.
 */
export interface PartnerStoreState {
  totalMeals: number;
  activeMeals: number;
  /** true = has items but all hidden → not accepting orders. */
  paused: boolean;
}

export function deriveStoreState(menu: readonly PartnerMenuItem[]): PartnerStoreState {
  const totalMeals = menu.length;
  const activeMeals = menu.filter((m) => m.isActive).length;
  return { totalMeals, activeMeals, paused: totalMeals > 0 && activeMeals === 0 };
}

/** Terminal (delivered / cancelled / refused) orders, newest first — read-only history. */
export async function loadHistoryOrders(db: Db, partnerId: string): Promise<PartnerOrderView[]> {
  const terminal = [...TERMINAL_ORDER_STATUSES];
  const orders = await db
    .select()
    .from(mealOrders)
    .where(and(eq(mealOrders.partnerId, partnerId), inArray(mealOrders.status, terminal)))
    .orderBy(desc(mealOrders.placedAt))
    .limit(200);
  if (orders.length === 0) return [];
  const items = await itemsByOrder(db, orders.map((o) => o.id));
  return orders.map((o) => serializePartnerOrder(o, items.get(o.id) ?? []));
}

/** The partner's own menu (non-deleted meals + their availability slots). */
export async function loadPartnerMenu(db: Db, partnerId: string): Promise<PartnerMenuItem[]> {
  const rows = await db
    .select()
    .from(meals)
    .where(and(eq(meals.partnerId, partnerId), eq(meals.isDeleted, false)))
    .orderBy(asc(meals.sortOrder), asc(meals.name));
  if (rows.length === 0) return [];

  const ids = rows.map((m) => m.id);
  const availRows = await db
    .select({
      mealId: mealAvailability.mealId,
      dayOfWeek: mealAvailability.dayOfWeek,
      window: mealAvailability.window,
    })
    .from(mealAvailability)
    .where(inArray(mealAvailability.mealId, ids));
  const availByMeal = new Map<string, { dayOfWeek: number; window: MealWindow }[]>();
  for (const a of availRows) {
    const list = availByMeal.get(a.mealId) ?? [];
    list.push({ dayOfWeek: a.dayOfWeek, window: a.window });
    availByMeal.set(a.mealId, list);
  }

  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    imageUrl: m.imageUrl,
    kcal: m.kcal,
    proteinG: m.proteinG,
    carbsG: m.carbsG,
    fatG: m.fatG,
    fiberG: m.fiberG,
    sugarG: m.sugarG,
    dietType: m.dietType,
    goalTags: m.goalTags as MealGoalTag[],
    priceMinor: m.priceMinor,
    currency: m.currency,
    isActive: m.isActive,
    sortOrder: m.sortOrder,
    availability: availByMeal.get(m.id) ?? [],
  }));
}

/** A single day's delivered-order revenue bucket. */
export interface EarningsDay {
  date: string;
  totalMinor: number;
  orders: number;
}

export interface PartnerEarnings {
  totalMinor: number;
  deliveredCount: number;
  currency: string;
  byDay: EarningsDay[];
}

/** Aggregate-only partner analytics. No member identity leaves this data layer. */
export interface PartnerDashboardStats {
  today: {
    totalOrders: number;
    customers: number;
    delivered: number;
    cancelled: number;
    revenueMinor: number;
  };
  customersInRange: number;
  bestSellers: {
    mealId: string;
    name: string;
    imageUrl: string | null;
    units: number;
    itemSalesMinor: number;
  }[];
}

/**
 * Delivered-order revenue for the partner over the trailing `sinceDate..` window
 * (inclusive), bucketed by delivery date. Only `delivered` orders count toward
 * earnings; cancelled/refused never do.
 */
export async function loadPartnerEarnings(
  db: Db,
  partnerId: string,
  sinceDate: string,
  currency: string,
): Promise<PartnerEarnings> {
  const rows = await db
    .select({
      date: mealOrders.deliveryDate,
      total: sql<string>`sum(${mealOrders.totalMinor})::text`,
      n: sql<string>`count(*)::text`,
    })
    .from(mealOrders)
    .where(
      and(
        eq(mealOrders.partnerId, partnerId),
        eq(mealOrders.status, 'delivered'),
        gte(mealOrders.deliveryDate, sinceDate),
      ),
    )
    .groupBy(mealOrders.deliveryDate)
    .orderBy(asc(mealOrders.deliveryDate));

  const byDay: EarningsDay[] = rows.map((r) => ({
    date: r.date,
    totalMinor: Number(r.total),
    orders: Number(r.n),
  }));
  const totalMinor = byDay.reduce((sum, d) => sum + d.totalMinor, 0);
  const deliveredCount = byDay.reduce((sum, d) => sum + d.orders, 0);
  return { totalMinor, deliveredCount, currency, byDay };
}

/**
 * Partner-scoped overview analytics for the dashboard. Counts are aggregated in
 * Postgres so the page never loads member rows or serializes account ids. Best
 * sellers include delivered orders only and use snapshotted item prices, which
 * keeps historical sales accurate after a menu price changes.
 */
export async function loadPartnerDashboardStats(
  db: Db,
  partnerId: string,
  today: string,
  sinceDate: string,
): Promise<PartnerDashboardStats> {
  const [todayRows, customerRows, sellerRows] = await Promise.all([
    db
      .select({
        totalOrders: sql<string>`count(*)::text`,
        customers: sql<string>`count(distinct ${mealOrders.accountId})::text`,
        delivered: sql<string>`coalesce(sum(case when ${mealOrders.status} = 'delivered' then 1 else 0 end), 0)::text`,
        cancelled: sql<string>`coalesce(sum(case when ${mealOrders.status} in ('cancelled', 'refused') then 1 else 0 end), 0)::text`,
        revenueMinor: sql<string>`coalesce(sum(case when ${mealOrders.status} = 'delivered' then ${mealOrders.totalMinor} else 0 end), 0)::text`,
      })
      .from(mealOrders)
      .where(and(eq(mealOrders.partnerId, partnerId), eq(mealOrders.deliveryDate, today))),
    db
      .select({ n: sql<string>`count(distinct ${mealOrders.accountId})::text` })
      .from(mealOrders)
      .where(
        and(
          eq(mealOrders.partnerId, partnerId),
          eq(mealOrders.status, 'delivered'),
          gte(mealOrders.deliveryDate, sinceDate),
        ),
      ),
    db
      .select({
        mealId: mealOrderItems.mealId,
        name: sql<string>`max(${mealOrderItems.nameSnapshot})`,
        imageUrl: meals.imageUrl,
        units: sql<string>`sum(${mealOrderItems.qty})::text`,
        itemSalesMinor: sql<string>`sum(${mealOrderItems.qty} * ${mealOrderItems.priceMinorSnapshot})::text`,
      })
      .from(mealOrderItems)
      .innerJoin(mealOrders, eq(mealOrderItems.orderId, mealOrders.id))
      .leftJoin(meals, eq(mealOrderItems.mealId, meals.id))
      .where(
        and(
          eq(mealOrders.partnerId, partnerId),
          eq(mealOrders.status, 'delivered'),
          gte(mealOrders.deliveryDate, sinceDate),
        ),
      )
      .groupBy(mealOrderItems.mealId, meals.imageUrl)
      .orderBy(desc(sql`sum(${mealOrderItems.qty})`))
      .limit(5),
  ]);

  const todayRow = todayRows[0];
  return {
    today: {
      totalOrders: Number(todayRow?.totalOrders ?? '0'),
      customers: Number(todayRow?.customers ?? '0'),
      delivered: Number(todayRow?.delivered ?? '0'),
      cancelled: Number(todayRow?.cancelled ?? '0'),
      revenueMinor: Number(todayRow?.revenueMinor ?? '0'),
    },
    customersInRange: Number(customerRows[0]?.n ?? '0'),
    bestSellers: sellerRows.map((row) => ({
      mealId: row.mealId,
      name: row.name,
      imageUrl: row.imageUrl,
      units: Number(row.units),
      itemSalesMinor: Number(row.itemSalesMinor),
    })),
  };
}

/** Count of ACTIVE subscriptions feeding this partner (for the summary tile). */
export async function countActiveSubscriptions(db: Db, partnerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)::text` })
    .from(mealSubscriptions)
    .where(and(eq(mealSubscriptions.partnerId, partnerId), eq(mealSubscriptions.status, 'active')));
  return Number(row?.n ?? '0');
}
