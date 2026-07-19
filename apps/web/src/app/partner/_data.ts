import 'server-only';

import {
  accounts,
  mealAvailability,
  mealBillingCycles,
  mealOrderEvents,
  mealOrderItems,
  mealOrders,
  meals,
  mealSubSkips,
  mealSubscriptions,
  savedAddresses,
  type Db,
} from '@gym/db';
import {
  TERMINAL_ORDER_STATUSES,
  ktmAddDays,
  ktmDayOfWeek,
  weekBoundsFor,
  type CycleStatus,
  type MealCurrency,
  type MealDietType,
  type MealGoalTag,
  type MealPaymentMethod,
  type MealWindow,
  type OrderStatus,
} from '@gym/shared';
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { effectivePermissionSet, type Permission, type Principal } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { buildPartnerOrderView } from '@/lib/meals';
import { staffFromCookie } from '@/lib/staffSession';
import { mealPartners } from '@gym/db';
import { isOrderLate } from './_format';

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
  /** Geocoded delivery pin for rider navigation; null when the address is text-only. */
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryNotes: string;
  items: { name: string; qty: number; priceMinorSnapshot: number }[];
  totalMinor: number;
  currency: MealCurrency;
  paymentMethod: MealPaymentMethod;
  paymentStatus: string;
  /**
   * True when the order's delivery window has already begun yet it is still
   * non-terminal — i.e. it needs the kitchen's attention now. Precomputed at
   * serialization time (server "now") so a client surface can highlight/lane
   * stuck orders without re-deriving KTM cutoffs (C-E; consumed by WP-7).
   */
  isLate: boolean;
}

type OrderRow = typeof mealOrders.$inferSelect;
type ItemRow = typeof mealOrderItems.$inferSelect;

/** Wrap the shared projection, serialize its one Date field, and stamp `isLate`. */
export function serializePartnerOrder(
  order: OrderRow,
  items: readonly ItemRow[],
  fallback?: { lat: number | null; lng: number | null },
): PartnerOrderView {
  const v = buildPartnerOrderView(order, items, fallback);
  const view: PartnerOrderView = { ...v, placedAt: v.placedAt.toISOString(), isLate: false };
  view.isLate = isOrderLate(view, Date.now());
  return view;
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
 *
 * Effective-permission gate (C-B / P0-3): like `requirePartner`, the caller's
 * effective set must contain BOTH `meals.own` AND `orders.fulfill`. A DENY
 * override on either native key (the only overrides the rail permits on a
 * partner) must lock the partner out of the SSR read surface too — otherwise the
 * override 403s every API call but leaves every server-rendered page (Today
 * board, roster, earnings, menu, history) fully disclosed. Fail closed: any
 * missing key OR an override-lookup failure redirects to login.
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

  let permissions: ReadonlySet<Permission>;
  try {
    permissions = await effectivePermissionSet(principal);
  } catch (err) {
    console.error('partner page permission override lookup failed:', err);
    redirect('/partner/login');
  }
  if (!permissions.has('meals.own') || !permissions.has('orders.fulfill')) {
    redirect('/partner/login');
  }

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

  const rows = await db
    .select({ order: mealOrders, addrLat: savedAddresses.lat, addrLng: savedAddresses.lng })
    .from(mealOrders)
    .leftJoin(savedAddresses, eq(savedAddresses.id, mealOrders.addressId))
    .where(and(...predicates))
    .orderBy(asc(mealOrders.cutoffAt))
    .limit(500);
  if (rows.length === 0) return [];
  const items = await itemsByOrder(db, rows.map((r) => r.order.id));
  return rows.map((r) =>
    serializePartnerOrder(r.order, items.get(r.order.id) ?? [], { lat: r.addrLat, lng: r.addrLng }),
  );
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
  const [row] = await db
    .select({ order: mealOrders, addrLat: savedAddresses.lat, addrLng: savedAddresses.lng })
    .from(mealOrders)
    .leftJoin(savedAddresses, eq(savedAddresses.id, mealOrders.addressId))
    .where(and(eq(mealOrders.id, orderId), eq(mealOrders.partnerId, partnerId)))
    .limit(1);
  if (!row) return null;
  const order = row.order;

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
    ...serializePartnerOrder(order, items, { lat: row.addrLat, lng: row.addrLng }),
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
  const rows = await db
    .select({ order: mealOrders, addrLat: savedAddresses.lat, addrLng: savedAddresses.lng })
    .from(mealOrders)
    .leftJoin(savedAddresses, eq(savedAddresses.id, mealOrders.addressId))
    .where(and(eq(mealOrders.partnerId, partnerId), inArray(mealOrders.status, terminal)))
    .orderBy(desc(mealOrders.placedAt))
    .limit(200);
  if (rows.length === 0) return [];
  const items = await itemsByOrder(db, rows.map((r) => r.order.id));
  return rows.map((r) =>
    serializePartnerOrder(r.order, items.get(r.order.id) ?? [], { lat: r.addrLat, lng: r.addrLng }),
  );
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
  /** Gross earned revenue = delivered, non-refunded orders (COD + digital). */
  totalMinor: number;
  /** Count of delivered, non-refunded orders. */
  deliveredCount: number;
  /**
   * Cash the restaurant collected at the door — delivered COD orders (non-
   * refunded). This money is already in the partner's hands; the platform holds
   * none of it.
   */
  codCollectedMinor: number;
  /**
   * Digital (eSewa/Khalti) money the PLATFORM currently holds for delivered,
   * paid orders — the payout precursor. Only `paid` digital orders count (an
   * unpaid digital order isn't money in hand for anyone); refunds are excluded.
   */
  digitalHeldMinor: number;
  /** Total value of delivered orders later refunded (excluded from `totalMinor`). */
  refundedMinor: number;
  /** Count of delivered orders later refunded. */
  refundedCount: number;
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
 * (inclusive), bucketed by delivery date, with the COD-vs-digital payment split.
 * Only `delivered` orders count toward earnings; cancelled/refused never do, and
 * an order later **refunded** is excluded from every earned figure (its value is
 * reported separately via `refundedMinor`). The split follows the money:
 *  - `codCollectedMinor` — cash the partner took at the door (COD, non-refunded);
 *  - `digitalHeldMinor` — eSewa/Khalti money the PLATFORM holds (paid only) and
 *    owes the partner (the payout precursor).
 * All figures are integer minor units.
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
      // Earned = delivered AND not refunded. A refunded delivered order returns
      // to zero for the partner, so it never counts toward total/cod/digital.
      total: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentStatus} <> 'refunded'), 0)::text`,
      n: sql<string>`count(*) filter (where ${mealOrders.paymentStatus} <> 'refunded')::text`,
      cod: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentMethod} = 'cod' and ${mealOrders.paymentStatus} <> 'refunded'), 0)::text`,
      digital: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentMethod} in ('esewa','khalti') and ${mealOrders.paymentStatus} = 'paid'), 0)::text`,
      refunded: sql<string>`coalesce(sum(${mealOrders.totalMinor}) filter (where ${mealOrders.paymentStatus} = 'refunded'), 0)::text`,
      refundedN: sql<string>`count(*) filter (where ${mealOrders.paymentStatus} = 'refunded')::text`,
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
  const codCollectedMinor = rows.reduce((sum, r) => sum + Number(r.cod), 0);
  const digitalHeldMinor = rows.reduce((sum, r) => sum + Number(r.digital), 0);
  const refundedMinor = rows.reduce((sum, r) => sum + Number(r.refunded), 0);
  const refundedCount = rows.reduce((sum, r) => sum + Number(r.refundedN), 0);
  return {
    totalMinor,
    deliveredCount,
    codCollectedMinor,
    digitalHeldMinor,
    refundedMinor,
    refundedCount,
    currency,
    byDay,
  };
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

// ── Subscription roster (WP-8) ──────────────────────────────────────────────
//
// The partner-facing subscriber roster is a MANAGEMENT view, not a fulfillment
// view: the restaurant needs to see who is subscribed, on what schedule, at what
// price, and — crucially — this week's billing state, so it can tell an *unpaid*
// week apart from a *skipped/paused/cancelled* one (§4.3). Because it is not a
// delivery surface, member contact is MASKED here (unlike the per-order
// projection, which reveals name/phone for the rider). No accountId ever leaves
// this layer.

const CUSTOMER_FALLBACK = 'Customer';

/** "Saksham Kandel" → "Saksham K." — first name plus surname initials only. */
function maskCustomerName(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return CUSTOMER_FALLBACK;
  const [first, ...rest] = parts;
  if (rest.length === 0) return first;
  return `${first} ${rest.map((p) => `${p.charAt(0).toUpperCase()}.`).join(' ')}`;
}

/** "+977 98-1234-5210" → "•••• 210" — last three digits only, never the full number. */
function maskPhone(phone: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 3) return '••••';
  return `•••• ${digits.slice(-3)}`;
}

/** One subscriber row in the partner roster — masked contact, no member identity. */
export interface PartnerSubscriptionRow {
  id: string;
  /** Masked display name (first name + surname initials). */
  customerLabel: string;
  /** Masked phone (last three digits). */
  phoneMasked: string;
  daysOfWeek: number[];
  window: MealWindow;
  planType: 'fixed_meal' | 'partner_rotating';
  /** Meal name for fixed plans (or "Removed meal" if deleted); null for rotating. */
  mealName: string | null;
  pricePerDayMinor: number;
  currency: MealCurrency;
  startDate: string;
  status: 'active' | 'paused' | 'cancelled';
  /** Scheduled deliveries per full week (count of subscribed weekdays). */
  weeklySlots: number;
  /** This (Sun–Sat KTM) week's billing cycle, or null if none exists yet. */
  thisWeekCycle: { status: CycleStatus; plannedSlots: number; amountMinor: number } | null;
}

const STATUS_RANK: Record<PartnerSubscriptionRow['status'], number> = {
  active: 0,
  paused: 1,
  cancelled: 2,
};

/**
 * The partner's full subscriber roster (active → paused → cancelled), each row
 * carrying its schedule, plan, price, start date, status, and THIS week's
 * billing-cycle state. Contact is masked (management, not delivery). Every read
 * is scoped to the caller's own `partnerId`. `today` is a KTM `YYYY-MM-DD`.
 */
export async function loadSubscriptionRoster(
  db: Db,
  partnerId: string,
  today: string,
): Promise<PartnerSubscriptionRow[]> {
  const rows = await db
    .select({
      id: mealSubscriptions.id,
      daysOfWeek: mealSubscriptions.daysOfWeek,
      window: mealSubscriptions.window,
      planType: mealSubscriptions.planType,
      mealId: mealSubscriptions.mealId,
      pricePerDayMinor: mealSubscriptions.pricePerDayMinor,
      currency: mealSubscriptions.currency,
      startDate: mealSubscriptions.startDate,
      status: mealSubscriptions.status,
      customerName: accounts.displayName,
      phone: savedAddresses.phone,
      mealName: meals.name,
    })
    .from(mealSubscriptions)
    .leftJoin(accounts, eq(accounts.id, mealSubscriptions.accountId))
    .leftJoin(savedAddresses, eq(savedAddresses.id, mealSubscriptions.addressId))
    .leftJoin(meals, eq(meals.id, mealSubscriptions.mealId))
    .where(eq(mealSubscriptions.partnerId, partnerId))
    .limit(500);
  if (rows.length === 0) return [];

  // This week's cycle per subscription (single batched read).
  const subIds = rows.map((r) => r.id);
  const weekStart = weekBoundsFor(today).weekStart;
  const cycleRows = await db
    .select({
      subscriptionId: mealBillingCycles.subscriptionId,
      status: mealBillingCycles.status,
      plannedSlots: mealBillingCycles.plannedSlots,
      amountMinor: mealBillingCycles.amountMinor,
    })
    .from(mealBillingCycles)
    .where(
      and(
        inArray(mealBillingCycles.subscriptionId, subIds),
        eq(mealBillingCycles.weekStart, weekStart),
      ),
    );
  const cycleBySub = new Map(
    cycleRows.map((c) => [
      c.subscriptionId,
      { status: c.status as CycleStatus, plannedSlots: c.plannedSlots, amountMinor: c.amountMinor },
    ]),
  );

  const mapped: PartnerSubscriptionRow[] = rows.map((r) => ({
    id: r.id,
    customerLabel: maskCustomerName(r.customerName),
    phoneMasked: maskPhone(r.phone),
    daysOfWeek: [...r.daysOfWeek].sort((a, b) => a - b),
    window: r.window,
    planType: r.planType,
    mealName: r.planType === 'fixed_meal' ? (r.mealName ?? 'Removed meal') : null,
    pricePerDayMinor: r.pricePerDayMinor,
    currency: r.currency,
    startDate: r.startDate,
    status: r.status,
    weeklySlots: r.daysOfWeek.length,
    thisWeekCycle: cycleBySub.get(r.id) ?? null,
  }));

  return mapped.sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.startDate.localeCompare(b.startDate),
  );
}

/** One forecast week: total scheduled subscription slots, split by window. */
export interface SubscriptionForecastWeek {
  weekStart: string;
  weekEnd: string;
  slots: number;
  lunch: number;
  dinner: number;
}

/** Read-only multi-week subscription-demand forecast for the partner. */
export interface SubscriptionForecast {
  weeks: SubscriptionForecastWeek[];
  activeCount: number;
  pausedCount: number;
}

/**
 * A forward-looking demand forecast for the partner's ACTIVE subscriptions,
 * derived PURELY from `daysOfWeek`/`startDate` (+ member skips) over the next
 * `weeks` KTM weeks. This is a schedule projection for kitchen capacity planning
 * — it deliberately does NOT touch the materializer's today+tomorrow spawn
 * horizon, nor apply cutoff/prepaid gating (those govern real order creation, not
 * what a member is *scheduled* to receive). Paused subs are excluded from the
 * counts but reported via `pausedCount`; cancelled subs are ignored entirely.
 */
export async function loadSubscriptionForecast(
  db: Db,
  partnerId: string,
  today: string,
  weeks = 4,
): Promise<SubscriptionForecast> {
  const subs = await db
    .select({
      id: mealSubscriptions.id,
      daysOfWeek: mealSubscriptions.daysOfWeek,
      window: mealSubscriptions.window,
      startDate: mealSubscriptions.startDate,
      status: mealSubscriptions.status,
    })
    .from(mealSubscriptions)
    .where(
      and(
        eq(mealSubscriptions.partnerId, partnerId),
        inArray(mealSubscriptions.status, ['active', 'paused']),
      ),
    )
    .limit(1000);

  const activeSubs = subs.filter((s) => s.status === 'active');
  const pausedCount = subs.length - activeSubs.length;

  const horizonEnd = ktmAddDays(today, weeks * 7 - 1);

  // Member skips inside the horizon suppress a scheduled slot.
  const skipSet = new Set<string>();
  if (activeSubs.length > 0) {
    const skipRows = await db
      .select({
        subscriptionId: mealSubSkips.subscriptionId,
        deliveryDate: mealSubSkips.deliveryDate,
      })
      .from(mealSubSkips)
      .where(
        and(
          inArray(
            mealSubSkips.subscriptionId,
            activeSubs.map((s) => s.id),
          ),
          gte(mealSubSkips.deliveryDate, today),
          lte(mealSubSkips.deliveryDate, horizonEnd),
        ),
      );
    for (const s of skipRows) skipSet.add(`${s.subscriptionId}|${s.deliveryDate}`);
  }

  // Walk every KTM date in the horizon, tallying scheduled slots per week bucket.
  const buckets = new Map<string, { lunch: number; dinner: number }>();
  for (let d = today; d <= horizonEnd; d = ktmAddDays(d, 1)) {
    const dow = ktmDayOfWeek(d);
    const weekStart = weekBoundsFor(d).weekStart;
    let bucket = buckets.get(weekStart);
    if (!bucket) {
      bucket = { lunch: 0, dinner: 0 };
      buckets.set(weekStart, bucket);
    }
    for (const sub of activeSubs) {
      if (d < sub.startDate) continue;
      if (!sub.daysOfWeek.includes(dow)) continue;
      if (skipSet.has(`${sub.id}|${d}`)) continue;
      if (sub.window === 'lunch') bucket.lunch += 1;
      else bucket.dinner += 1;
    }
  }

  // The horizon runs today..horizonEnd, which need not align to week boundaries,
  // so the first and last calendar-week buckets are partial: they only tally the
  // dates actually inside the horizon. Clamp the displayed range to the counted
  // span (never before `today`, never after `horizonEnd`) so a partial edge week
  // isn't mislabeled with its full Sun–Sat range and read as under-booked.
  const weekRows: SubscriptionForecastWeek[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, b]) => {
      const fullEnd = weekBoundsFor(weekStart).weekEnd;
      return {
        weekStart: weekStart < today ? today : weekStart,
        weekEnd: fullEnd > horizonEnd ? horizonEnd : fullEnd,
        slots: b.lunch + b.dinner,
        lunch: b.lunch,
        dinner: b.dinner,
      };
    });

  return { weeks: weekRows, activeCount: activeSubs.length, pausedCount };
}
