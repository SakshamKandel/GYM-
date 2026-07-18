import { z } from 'zod';
import { GYM_AMENITIES, GYM_CATEGORIES, GYM_DAY_KEYS, type GymAmenity } from '@gym/shared';
import { BASE_URL } from '../../lib/api/client';

/**
 * Nearby-gyms API client — public discovery surface (plan §4/§7 P7). Unlike
 * the coach directory this needs NO session token: `/api/gyms` and
 * `/api/gyms/[slug]` are unauthenticated on the server, so anonymous visitors
 * can browse gyms before ever signing in. Same philosophy as
 * features/mentorship/api.ts otherwise: zod at the boundary (CLAUDE.md rule
 * 8), typed `GymsApiError` codes so screens branch on `.code`.
 */

export type GymsErrorCode = 'not_found' | 'invalid' | 'network';

export class GymsApiError extends Error {
  readonly code: GymsErrorCode;

  constructor(code: GymsErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'GymsApiError';
    this.code = code;
  }
}

export function toGymsError(err: unknown): GymsApiError {
  return err instanceof GymsApiError ? err : new GymsApiError('network');
}

// ── Schemas ───────────────────────────────────────────────────

// z.enum needs a non-empty tuple type; GYM_CATEGORIES is typed as a plain
// readonly array in @gym/shared (its values are still the exact literal
// union at runtime), so this cast is a type-only adjustment.
const gymCategorySchema = z
  .enum(GYM_CATEGORIES as unknown as [(typeof GYM_CATEGORIES)[number], ...(typeof GYM_CATEGORIES)[number][]])
  .catch('other');
export type GymCategory = z.infer<typeof gymCategorySchema>;

const shiftSchema = z.object({ open: z.string(), close: z.string() });

/** Partial per-day shift map — an absent/empty day means closed. Unknown
 * shapes drop rather than fail the whole gym (resilient list philosophy). */
const hoursSchema = z
  .object(Object.fromEntries(GYM_DAY_KEYS.map((k) => [k, z.array(shiftSchema).optional()])))
  .partial()
  .catch({});
export type GymHours = z.infer<typeof hoursSchema>;

/** Drop any amenity key the client doesn't recognise yet (forward-compatible
 * with new amenities added server-side after this build shipped). */
const KNOWN_AMENITIES = new Set<string>(GYM_AMENITIES);
const amenitiesSchema = z
  .array(z.unknown())
  .transform((arr) => arr.filter((v): v is GymAmenity => typeof v === 'string' && KNOWN_AMENITIES.has(v)))
  .catch([]);

const photoSchema = z.object({ deliveryUrl: z.string() });

const gymCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: gymCategorySchema,
  city: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  photos: z.array(photoSchema).catch([]),
  distanceKm: z.number().nullable().catch(null),
});
export type GymCard = z.infer<typeof gymCardSchema>;

/** Resilient list — one bad row must not blank the whole directory. */
const gymListSchema = z.object({
  gyms: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): GymCard[] => {
      const parsed = gymCardSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const socialLinkSchema = z.object({ platform: z.string(), url: z.string() });

const gymDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: gymCategorySchema,
  addressText: z.string(),
  city: z.string(),
  district: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  phone: z.string(),
  website: z.string().nullable(),
  socialLinks: z.array(socialLinkSchema).catch([]),
  hours: hoursSchema,
  amenities: amenitiesSchema,
  externalImageUrl: z.string().nullable(),
  priceNote: z.string(),
  description: z.string(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  photos: z.array(z.object({ id: z.string(), deliveryUrl: z.string() })).catch([]),
});
export type GymDetail = z.infer<typeof gymDetailSchema>;

const gymDetailEnvelope = z.object({ gym: gymDetailSchema });

// ── Fetch plumbing ────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const errorBodySchema = z.object({ error: z.string() });

function statusToCode(status: number): GymsErrorCode {
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid';
  return 'network';
}

async function gymsRequest(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}${path}`, { method: 'GET', headers: { Accept: 'application/json' } });
  } catch {
    throw new GymsApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new GymsApiError('network', 'Unexpected server response');
    }
  }

  let code = statusToCode(res.status);
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success && parsed.data.error === 'not_found') code = 'not_found';
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new GymsApiError(code);
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new GymsApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Endpoints ──────────────────────────────────────────────────

/** GET /api/gyms?lat&lng&q → published+verified gyms, nearest-first when
 * `lat`/`lng` are given. Unauthenticated — safe to call signed out. */
export async function fetchGyms(opts?: { lat?: number; lng?: number; q?: string }): Promise<GymCard[]> {
  const params = new URLSearchParams();
  if (opts?.lat !== undefined) params.set('lat', String(opts.lat));
  if (opts?.lng !== undefined) params.set('lng', String(opts.lng));
  if (opts?.q) params.set('q', opts.q);
  const qs = params.toString();
  const data = await gymsRequest(`/api/gyms${qs ? `?${qs}` : ''}`);
  return parse(gymListSchema, data).gyms;
}

/** GET /api/gyms/[slug] → one gym's full detail. Throws 'not_found' for a
 * draft/archived/unverified/unknown slug. */
export async function fetchGymDetail(slug: string): Promise<GymDetail> {
  const data = await gymsRequest(`/api/gyms/${encodeURIComponent(slug)}`);
  return parse(gymDetailEnvelope, data).gym;
}
