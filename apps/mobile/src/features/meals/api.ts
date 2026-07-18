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

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'MealsApiError';
    this.code = code;
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

const pendingCycleSchema = z.object({
  id: z.string(),
  weekStart: z.string(),
  weekEnd: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
});
export type MealPendingCycle = z.infer<typeof pendingCycleSchema>;

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
  // Additive (older server responses simply lack it): the oldest still-unpaid
  // weekly bill for this plan, if any — the only client-visible way to
  // discover a `cycleId` to pay via submitMealReceipt.
  pendingCycle: pendingCycleSchema.nullable().catch(null).optional(),
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

const errorBodySchema = z.object({ error: z.string() });

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
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) code = parsed.data.error;
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new MealsApiError(code);
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

export interface CreateMealOrderInput {
  partnerId: string;
  deliveryDate: string;
  window: MealWindow;
  addressId: string;
  items: { mealId: string; qty: number }[];
  paymentMethod: MealPaymentMethod;
  notes?: string;
}

/** POST /api/meals/orders → place a one-time order. The server freezes price,
 * fees and cutoff — this client only submits the member's picks. */
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
