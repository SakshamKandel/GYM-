import { z } from 'zod';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';

/**
 * Member meal-delivery API client (plan §6/§7 P12, contracts frozen §8).
 * Every meals route requires a signed-in member (`authedUser`) — unlike
 * features/gyms/api.ts's public discovery, every call here carries a bearer
 * token. Same philosophy as the rest of the app's API clients: zod at the
 * boundary (CLAUDE.md rule 8), a typed error class, resilient lists (one bad
 * row never blanks a whole screen), and network failures never throw
 * something the UI can't label.
 *
 * `code` deliberately stays a plain string (not a closed union): the server
 * surfaces business-specific codes per route (`past_cutoff`,
 * `cod_unavailable`, `receipt_already_used`, …) and this client must stay
 * forward-compatible with new ones. `mealErrorMessage` in logic.ts maps the
 * codes this UI knows about to copy, with a generic fallback for the rest.
 */

export class MealsApiError extends Error {
  readonly code: string;
  /** The full error-response body (minus `error`), when the server sent one —
   * e.g. `{quotedMinor,currentMinor}` on `price_changed`, `{mealId,mealName}`
   * on `meal_unavailable`, `{refund}` on a subscription cancel `refund_required`
   * block. Absent on network failures or plain `{error}` bodies. */
  readonly details?: Record<string, unknown>;

  constructor(code: string, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'MealsApiError';
    this.code = code;
    this.details = details;
  }
}

export function toMealsError(err: unknown): MealsApiError {
  return err instanceof MealsApiError ? err : new MealsApiError('network');
}

// ── Shared enums / shapes ────────────────────────────────────────

const mealWindowSchema = z.enum(['lunch', 'dinner']);
const currencySchema = z.enum(['NPR', 'USD']);
const dietTypeSchema = z.enum(['veg', 'non_veg', 'egg']);
const goalTagSchema = z.enum(['cutting', 'bulking', 'balanced']);
const paymentMethodSchema = z.enum(['esewa', 'khalti', 'cod']);
const orderStatusSchema = z.enum([
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refused',
]);
const paymentStatusSchema = z.enum(['unpaid', 'receipt_submitted', 'paid', 'refunded']);
const subscriptionStatusSchema = z.enum(['active', 'paused', 'cancelled']);
const planTypeSchema = z.enum(['fixed_meal', 'partner_rotating']);

export type MealWindow = z.infer<typeof mealWindowSchema>;
export type MealCurrency = z.infer<typeof currencySchema>;
export type MealDietType = z.infer<typeof dietTypeSchema>;
export type MealGoalTag = z.infer<typeof goalTagSchema>;
export type MealPaymentMethod = z.infer<typeof paymentMethodSchema>;
export type MealOrderStatus = z.infer<typeof orderStatusSchema>;
export type MealPaymentStatus = z.infer<typeof paymentStatusSchema>;
export type MealSubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type MealPlanType = z.infer<typeof planTypeSchema>;

// ── Partners / menu ──────────────────────────────────────────────

const partnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  serviceAreas: z.array(z.string()).catch([]),
  acceptsCod: z.boolean(),
  currency: currencySchema,
  // Geo reach (additive 2026-07-18 geo wave): the partner's kitchen/dispatch
  // point + delivery radius. Older server responses simply lack these, and a
  // partner that hasn't set a geo origin sends null — both read the same as
  // "no geo data" to callers (features/meals/components/DeliveryBadge.tsx
  // falls back to a `serviceAreas` text match in that case).
  serviceLat: z.number().nullable().catch(null).optional(),
  serviceLng: z.number().nullable().catch(null).optional(),
  serviceRadiusKm: z.number().nullable().catch(null).optional(),
});
export type MealPartner = z.infer<typeof partnerSchema>;

const partnerListSchema = z.object({
  partners: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): MealPartner[] => {
      const parsed = partnerSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const menuMealSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().catch(''),
  imageUrl: z.string().nullable().catch(null),
  kcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  fiberG: z.number().nullable().optional(),
  sugarG: z.number().nullable().optional(),
  dietType: dietTypeSchema,
  goalTags: z.array(goalTagSchema).catch([]),
  priceMinor: z.number(),
  currency: currencySchema,
  // Pack F real inventory: the partner toggled this meal sold-out for the
  // requested (date, window) slot. Only ever populated when the menu fetch
  // carried both `date` and `window` filters; absent otherwise → false (never
  // hides the meal, just disables ordering it — see MealItemCard).
  soldOut: z.boolean().catch(false),
});
export type MenuMeal = z.infer<typeof menuMealSchema>;

const menuListSchema = z.object({
  meals: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): MenuMeal[] => {
      const parsed = menuMealSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

// ── Orders ────────────────────────────────────────────────────────

const orderMacrosSchema = z.object({
  kcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  fiberG: z.number().nullable().optional(),
  sugarG: z.number().nullable().optional(),
});

const orderItemSchema = z.object({
  mealId: z.string(),
  name: z.string(),
  priceMinorSnapshot: z.number(),
  macros: orderMacrosSchema,
  qty: z.number(),
});
export type MealOrderItem = z.infer<typeof orderItemSchema>;

const orderSchema = z.object({
  id: z.string(),
  // Short human-readable code (Pack A confirmation/receipt/tracking). Older
  // cached shapes simply lack it — fall back to a raw-id-derived placeholder
  // rather than crashing the parse (never actually hit against a live server).
  orderNumber: z.string().catch(''),
  source: z.enum(['one_time', 'subscription']),
  partnerId: z.string(),
  subscriptionId: z.string().nullable(),
  deliveryDate: z.string(),
  window: mealWindowSchema,
  deliveryName: z.string(),
  deliveryPhone: z.string(),
  deliveryAddressText: z.string(),
  deliveryNotes: z.string(),
  subtotalMinor: z.number(),
  deliveryFeeMinor: z.number(),
  smallOrderFeeMinor: z.number(),
  tipMinor: z.number().catch(0),
  totalMinor: z.number(),
  currency: currencySchema,
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema,
  status: orderStatusSchema,
  cutoffAt: z.string(),
  placedAt: z.string(),
  confirmedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  items: z.array(orderItemSchema).catch([]),
});
export type MealOrder = z.infer<typeof orderSchema>;

const orderEnvelope = z.object({ order: orderSchema });

const orderListSchema = z.object({
  orders: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): MealOrder[] => {
      const parsed = orderSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

// ── Subscriptions ─────────────────────────────────────────────────

const cycleStatusSchema = z.enum(['open', 'awaiting_payment', 'receipt_submitted', 'paid', 'void']);

const cycleInvoiceSchema = z.object({
  cycleId: z.string(),
  weekStart: z.string(),
  weekEnd: z.string(),
  plannedSlots: z.number(),
  pricePerDayMinor: z.number(),
  amountMinor: z.number(),
  currency: z.string(),
  status: cycleStatusSchema,
});
export type MealCycleInvoice = z.infer<typeof cycleInvoiceSchema>;

const pendingCycleSchema = z.object({
  id: z.string(),
  weekStart: z.string(),
  weekEnd: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  status: cycleStatusSchema.optional(),
  // Pack G / B5: the member uploaded a receipt and it's awaiting staff review
  // — the card must show "under review", NOT a live Pay button. Older cached
  // shapes lack this field; a missing value reads as "not submitted" (safe
  // default — never hides a genuinely pending Pay affordance).
  receiptSubmitted: z.boolean().catch(false).optional(),
  invoice: cycleInvoiceSchema.optional(),
});
export type MealPendingCycle = z.infer<typeof pendingCycleSchema>;

const upcomingDeliverySchema = z.object({ date: z.string(), window: mealWindowSchema });
export type MealUpcomingDelivery = z.infer<typeof upcomingDeliverySchema>;

const subscriptionSchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  daysOfWeek: z.array(z.number()).catch([]),
  window: mealWindowSchema,
  planType: planTypeSchema,
  mealId: z.string().nullable(),
  addressId: z.string(),
  pricePerDayMinor: z.number(),
  currency: currencySchema,
  paymentMethod: paymentMethodSchema,
  startDate: z.string(),
  status: subscriptionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  // Additive (older server responses simply lack it): the oldest still-unpaid
  // weekly bill for this plan, if any — the only client-visible way to
  // discover a `cycleId` to pay via submitMealReceipt.
  pendingCycle: pendingCycleSchema.nullable().catch(null).optional(),
  // "Deliveries scheduled for …" forward projection (Pack G). Older cached
  // shapes lack it; absent → empty (the card simply omits the strip).
  upcomingDeliveries: z.array(upcomingDeliverySchema).catch([]).optional(),
});
export type MealSubscription = z.infer<typeof subscriptionSchema>;

const subscriptionListSchema = z.object({
  subscriptions: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): MealSubscription[] => {
      const parsed = subscriptionSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const subscriptionEnvelope = z.object({
  subscription: z.object({ id: z.string(), status: subscriptionStatusSchema }),
});

const subscriptionPlanQuoteSchema = z.object({
  pricePerDayMinor: z.number().int().nonnegative(),
  currency: currencySchema,
  deliveryFeeMinor: z.number().int().nonnegative(),
});
export type MealSubscriptionPlanQuote = z.infer<typeof subscriptionPlanQuoteSchema>;

const subscriptionEditResultSchema = z.object({
  subscription: z.object({
    id: z.string(),
    status: subscriptionStatusSchema,
    daysOfWeek: z.array(z.number().int().min(0).max(6)),
    window: mealWindowSchema,
    planType: planTypeSchema,
    mealId: z.string().nullable(),
    addressId: z.string(),
    pricePerDayMinor: z.number().int().nonnegative(),
    currency: currencySchema,
  }),
  effective: z.object({
    mode: z.literal('future_unmaterialized'),
    fromDate: z.string(),
    preservedOrderDates: z.array(z.string()),
  }),
});
export type MealSubscriptionEditResult = z.infer<typeof subscriptionEditResultSchema>;

// ── Addresses ─────────────────────────────────────────────────────

const addressSchema = z.object({
  id: z.string(),
  label: z.string().catch(''),
  line: z.string(),
  area: z.string().catch(''),
  phone: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  isDefault: z.boolean(),
});
export type MealAddress = z.infer<typeof addressSchema>;

const addressListSchema = z.object({
  addresses: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): MealAddress[] => {
      const parsed = addressSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const addressEnvelope = z.object({ address: addressSchema });

// ── Payments ──────────────────────────────────────────────────────

const paymentRequestSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'refunded']),
});
export type MealPaymentRequestResult = z.infer<typeof paymentRequestSchema>;

const paymentEnvelope = z.object({ request: paymentRequestSchema });

// ── Fetch plumbing ────────────────────────────────────────────────

const errorBodySchema = z.object({ error: z.string() }).passthrough();

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

async function mealsRequest(opts: RequestOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}${opts.path}`, {
      method: opts.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new MealsApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new MealsApiError('network', 'Unexpected server response');
    }
  }

  let code = res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'network';
  let details: Record<string, unknown> | undefined;
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) {
      code = parsed.data.error;
      const { error: _error, ...rest } = parsed.data;
      if (Object.keys(rest).length > 0) details = rest;
    }
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new MealsApiError(code, undefined, details);
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new MealsApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Endpoints (client fn names frozen §8) ──────────────────────────

/** GET /api/meals/partners → active partners this member may order from. */
export async function fetchMealPartners(token: string): Promise<MealPartner[]> {
  const data = await mealsRequest({ method: 'GET', path: '/api/meals/partners', token });
  return parse(partnerListSchema, data).partners;
}

export interface MealMenuFilters {
  goal?: MealGoalTag;
  diet?: MealDietType;
  date?: string;
  window?: MealWindow;
}

/** GET /api/meals/menu?partnerId&goal&diet&date&window → a partner's orderable menu. */
export async function fetchMealMenu(
  token: string,
  partnerId: string,
  filters?: MealMenuFilters,
): Promise<MenuMeal[]> {
  const params = new URLSearchParams({ partnerId });
  if (filters?.goal) params.set('goal', filters.goal);
  if (filters?.diet) params.set('diet', filters.diet);
  if (filters?.date) params.set('date', filters.date);
  if (filters?.window) params.set('window', filters.window);
  const data = await mealsRequest({
    method: 'GET',
    path: `/api/meals/menu?${params.toString()}`,
    token,
  });
  return parse(menuListSchema, data).meals;
}

// ── Checkout quote (POST /api/meals/quote) ──────────────────────────

const mealQuoteSchema = z.object({
  subtotalMinor: z.number(),
  deliveryFeeMinor: z.number(),
  smallOrderFeeMinor: z.number(),
  tipMinor: z.number().catch(0),
  totalMinor: z.number(),
  currency: currencySchema,
  // true = the partner delivers to the chosen address, false = out of range,
  // null = undeterminable (no geocoded pin / text-only address).
  deliversTo: z.boolean().nullable(),
});
export type MealQuote = z.infer<typeof mealQuoteSchema>;

export interface MealQuoteInput {
  partnerId: string;
  items: { mealId: string; qty: number }[];
  /** A saved delivery address id, when quoting against one. */
  addressId?: string;
  window: MealWindow;
  /** 'YYYY-MM-DD' delivery date. */
  date: string;
  /** Optional gratuity preview (Pack D); server-repriced. */
  tipMinor?: number;
}

/** POST /api/meals/quote → the priced order preview (subtotal + delivery fee +
 * small-order fee + tip + grand total) plus `deliversTo` coverage, WITHOUT
 * placing anything. On a `meal_unavailable` (422) the thrown MealsApiError's
 * `details` carries `{mealId, mealName}` naming which line failed (B11) —
 * never a bare slot message. */
export async function fetchMealQuote(token: string, input: MealQuoteInput): Promise<MealQuote> {
  const data = await mealsRequest({
    method: 'POST',
    path: '/api/meals/quote',
    token,
    body: {
      partnerId: input.partnerId,
      items: input.items,
      ...(input.addressId !== undefined ? { addressId: input.addressId } : {}),
      window: input.window,
      date: input.date,
      ...(input.tipMinor !== undefined ? { tipMinor: input.tipMinor } : {}),
    },
  });
  return parse(mealQuoteSchema, data);
}

export interface CreateMealOrderInput {
  requestId: string;
  partnerId: string;
  deliveryDate: string;
  window: MealWindow;
  addressId: string;
  items: { mealId: string; qty: number }[];
  paymentMethod: MealPaymentMethod;
  notes?: string;
  /** Optional checkout gratuity (Pack D) — server-repriced via validateTipMinor. */
  tipMinor?: number;
  /** The total the member was SHOWN at quote time (B10/Pack F price-change
   * guard). A server re-price that disagrees returns 409 `price_changed`
   * WITHOUT charging — see {@link MealsApiError.details}. */
  expectedTotalMinor?: number;
}

/** POST /api/meals/orders → place a one-time order. The server freezes price,
 * fees and cutoff. `requestId` must be reused for retries of the same intent. */
export async function createMealOrder(token: string, input: CreateMealOrderInput): Promise<MealOrder> {
  const data = await mealsRequest({ method: 'POST', path: '/api/meals/orders', token, body: { ...input } });
  return parse(orderEnvelope, data).order;
}

/** GET /api/meals/orders?scope=upcoming|history → the caller's own orders. */
export async function fetchMyMealOrders(
  token: string,
  scope: 'upcoming' | 'history' = 'upcoming',
): Promise<MealOrder[]> {
  const data = await mealsRequest({ method: 'GET', path: `/api/meals/orders?scope=${scope}`, token });
  return parse(orderListSchema, data).orders;
}

/** POST /api/meals/orders/[id]/cancel — member cancel, PENDING + pre-cutoff only. */
export async function cancelMealOrder(token: string, orderId: string, reason?: string): Promise<MealOrder> {
  const data = await mealsRequest({
    method: 'POST',
    path: `/api/meals/orders/${encodeURIComponent(orderId)}/cancel`,
    token,
    body: reason ? { reason } : {},
  });
  return parse(orderEnvelope, data).order;
}

export interface CreateMealSubscriptionInput {
  partnerId: string;
  daysOfWeek: number[];
  window: MealWindow;
  planType: MealPlanType;
  mealId?: string;
  addressId: string;
  paymentMethod: MealPaymentMethod;
  startDate: string;
}

/** POST /api/meals/subscriptions → create a recurring plan (server prices it). */
export async function createMealSubscription(
  token: string,
  input: CreateMealSubscriptionInput,
): Promise<MealSubscription> {
  const data = await mealsRequest({
    method: 'POST',
    path: '/api/meals/subscriptions',
    token,
    body: { ...input },
  });
  return parse(z.object({ subscription: subscriptionSchema }), data).subscription;
}

/** GET /api/meals/subscriptions → the caller's subscriptions (all statuses). */
export async function fetchMealSubscriptions(token: string): Promise<MealSubscription[]> {
  const data = await mealsRequest({ method: 'GET', path: '/api/meals/subscriptions', token });
  return parse(subscriptionListSchema, data).subscriptions;
}

/** PATCH /api/meals/subscriptions/[id] {action} → pause | resume | cancel. */
export async function updateMealSubscription(
  token: string,
  subscriptionId: string,
  action: 'pause' | 'resume' | 'cancel',
): Promise<{ id: string; status: MealSubscriptionStatus }> {
  const data = await mealsRequest({
    method: 'PATCH',
    path: `/api/meals/subscriptions/${encodeURIComponent(subscriptionId)}`,
    token,
    body: { action },
  });
  return parse(subscriptionEnvelope, data).subscription;
}

export interface MealSubscriptionEditInput {
  daysOfWeek: number[];
  window: MealWindow;
  planType: MealPlanType;
  mealId: string | null;
  addressId: string;
}

/** Live preview only; editMealSubscription re-quotes on the write path. */
export async function quoteMealSubscriptionEdit(
  token: string,
  subscriptionId: string,
  input: MealSubscriptionEditInput,
): Promise<MealSubscriptionPlanQuote> {
  const data = await mealsRequest({
    method: 'POST',
    path: `/api/meals/subscriptions/${encodeURIComponent(subscriptionId)}/quote`,
    token,
    body: { ...input },
  });
  return parse(z.object({ quote: subscriptionPlanQuoteSchema }), data).quote;
}

/** Edit future unfunded deliveries; existing order snapshots remain frozen. */
export async function editMealSubscription(
  token: string,
  subscriptionId: string,
  input: MealSubscriptionEditInput,
): Promise<MealSubscriptionEditResult> {
  const data = await mealsRequest({
    method: 'PATCH',
    path: `/api/meals/subscriptions/${encodeURIComponent(subscriptionId)}`,
    token,
    body: { action: 'edit', ...input },
  });
  return parse(subscriptionEditResultSchema, data);
}

/** POST /api/meals/subscriptions/[id]/skip {deliveryDate} — skip one delivery day. */
export async function skipMealDay(token: string, subscriptionId: string, deliveryDate: string): Promise<void> {
  await mealsRequest({
    method: 'POST',
    path: `/api/meals/subscriptions/${encodeURIComponent(subscriptionId)}/skip`,
    token,
    body: { deliveryDate },
  });
}

export interface SaveAddressInput {
  label?: string;
  line: string;
  area?: string;
  phone: string;
  lat?: number;
  lng?: number;
  isDefault?: boolean;
}

/** GET /api/meals/addresses → the caller's saved delivery addresses. */
export async function listAddresses(token: string): Promise<MealAddress[]> {
  const data = await mealsRequest({ method: 'GET', path: '/api/meals/addresses', token });
  return parse(addressListSchema, data).addresses;
}

/** POST (new) / PATCH (update, pass `id`) /api/meals/addresses. */
export async function saveAddress(
  token: string,
  input: SaveAddressInput & { id?: string },
): Promise<MealAddress> {
  const { id, ...rest } = input;
  const data = await mealsRequest({
    method: id ? 'PATCH' : 'POST',
    path: '/api/meals/addresses',
    token,
    body: id ? { id, ...rest } : { ...rest },
  });
  return parse(addressEnvelope, data).address;
}

/** DELETE /api/meals/addresses {id} — soft delete (prior orders keep their FK). */
export async function deleteAddress(token: string, id: string): Promise<void> {
  await mealsRequest({ method: 'DELETE', path: '/api/meals/addresses', token, body: { id } });
}

// ── Geocoding ─────────────────────────────────────────────────────

const geoResultSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
});
export type GeoResult = z.infer<typeof geoResultSchema>;

const geoResultsSchema = z.object({
  results: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): GeoResult[] => {
      const parsed = geoResultSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/geo/search?q= → up to 5 Nominatim-backed candidate points for a
 * free-text address (server proxy: auth-gated, rate-limited, cached). Used to
 * let a member pin a saved delivery address to a lat/lng on save (courtesy
 * geocoding — the address text itself is always still saved even if this
 * fails or the member skips it). */
export async function searchGeo(token: string, q: string): Promise<GeoResult[]> {
  const data = await mealsRequest({
    method: 'GET',
    path: `/api/geo/search?q=${encodeURIComponent(q)}`,
    token,
  });
  return parse(geoResultsSchema, data).results;
}

export interface SubmitMealReceiptInput {
  orderId?: string;
  cycleId?: string;
  method: 'esewa' | 'khalti';
  receiptUrl: string;
  note?: string;
}

/** POST /api/meals/payments → submit an eSewa/Khalti receipt for review
 * (exactly one of orderId/cycleId). COD never routes here. */
export async function submitMealReceipt(
  token: string,
  input: SubmitMealReceiptInput,
): Promise<MealPaymentRequestResult> {
  const data = await mealsRequest({ method: 'POST', path: '/api/meals/payments', token, body: { ...input } });
  return parse(paymentEnvelope, data).request;
}

// ── Post-delivery: rating / tip / dispute / receipt (Pack A/C/D/E) ─

/** POST /api/meals/orders/[id]/rating {stars, note?} — only once the order is
 * `delivered`; a second submit 409s `already_rated`. */
export async function rateMealOrder(
  token: string,
  orderId: string,
  input: { stars: number; note?: string },
): Promise<void> {
  await mealsRequest({
    method: 'POST',
    path: `/api/meals/orders/${encodeURIComponent(orderId)}/rating`,
    token,
    body: { ...input },
  });
}

/** POST /api/meals/orders/[id]/tip {tipMinor} — server-repriced gratuity; only
 * while the order is still `unpaid`. Returns the updated order (new total). */
export async function setMealOrderTip(token: string, orderId: string, tipMinor: number): Promise<MealOrder> {
  const data = await mealsRequest({
    method: 'POST',
    path: `/api/meals/orders/${encodeURIComponent(orderId)}/tip`,
    token,
    body: { tipMinor },
  });
  return parse(orderEnvelope, data).order;
}

/** A member's reason for filing a dispute (Pack E). Mirrors @gym/shared's
 * `DisputeReason` union — kept a plain string here (not re-exported) so this
 * client stays forward-compatible with a server-added reason. */
export type MealDisputeReason = 'not_delivered' | 'wrong_items' | 'quality' | 'late' | 'other';

/** POST /api/meals/orders/[id]/dispute {reason, note?} — files a non-delivery
 * / problem case; only from a terminal delivered/paid state. Resolution is
 * admin-authoritative (never auto-refunds) — this only opens the case. */
export async function fileMealDispute(
  token: string,
  orderId: string,
  input: { reason: MealDisputeReason; note?: string },
): Promise<{ id: string; status: string }> {
  const data = await mealsRequest({
    method: 'POST',
    path: `/api/meals/orders/${encodeURIComponent(orderId)}/dispute`,
    token,
    body: { ...input },
  });
  return parse(z.object({ dispute: z.object({ id: z.string(), status: z.string() }) }), data).dispute;
}

const receiptTimelineRowSchema = z.object({
  status: orderStatusSchema,
  at: z.string(),
  note: z.string().nullable(),
});

const orderReceiptSchema = z.object({
  orderNumber: z.string(),
  placedAt: z.string(),
  items: z.array(
    z.object({ name: z.string(), qty: z.number(), priceMinorSnapshot: z.number() }),
  ),
  subtotalMinor: z.number(),
  deliveryFeeMinor: z.number(),
  smallOrderFeeMinor: z.number(),
  tipMinor: z.number().catch(0),
  totalMinor: z.number(),
  currency: currencySchema,
  status: orderStatusSchema,
  timeline: z.array(receiptTimelineRowSchema).catch([]),
});
export type MealOrderReceipt = z.infer<typeof orderReceiptSchema>;

/** GET /api/meals/orders/[id]/receipt → the downloadable/shareable invoice
 * (order number, itemized fees, tip, total, status timeline). Owner-scoped. */
export async function fetchMealOrderReceipt(token: string, orderId: string): Promise<MealOrderReceipt> {
  const data = await mealsRequest({
    method: 'GET',
    path: `/api/meals/orders/${encodeURIComponent(orderId)}/receipt`,
    token,
  });
  return parse(orderReceiptSchema, data);
}
