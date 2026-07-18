import { latLngSchema } from '@gym/shared';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { staffFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';

/**
 * Server-side geocoding proxy to OpenStreetMap Nominatim (§geo). Clients NEVER
 * hit Nominatim directly — this route is the single choke point so we can:
 *  - identify the app via a required User-Agent (Nominatim usage policy),
 *  - rate-limit to 10/min/IP (best-effort abuse damping; see lib/rateLimit),
 *  - cap results at 5 and validate the shape with zod before returning,
 *  - cache each normalized query for 24h in a bounded in-memory LRU so repeated
 *    lookups (and Nominatim's 1 req/s ceiling) never bite the user.
 *
 * The response is a frozen minimal shape: [{ label, lat, lng }] — no Nominatim
 * internals (place_id, licence, bounding boxes) leak to clients.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Nominatim asks for a real contact identifying the application.
const USER_AGENT = 'GymTrackerApp/1.0 (+https://gym.app; contact: nlooptech@gmail.com)';
const RESULT_CAP = 5;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX_ENTRIES = 500;

export interface GeoResult {
  label: string;
  lat: number;
  lng: number;
}

const querySchema = z.object({
  q: z.string().trim().min(2, 'q too short').max(200),
});

/** One raw Nominatim hit we care about; everything else is ignored. */
const nominatimHitSchema = z.object({
  display_name: z.string(),
  lat: z.string(),
  lon: z.string(),
});

interface CacheEntry {
  results: GeoResult[];
  expiresAt: number;
}

// Insertion-ordered Map used as an LRU: on read we re-insert to mark recency;
// on write we evict the oldest key once over capacity.
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): GeoResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // Mark as most-recently-used.
  cache.delete(key);
  cache.set(key, entry);
  return entry.results;
}

function cacheSet(key: string, results: GeoResult[]): void {
  cache.delete(key);
  cache.set(key, { results, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  // Auth-gate so the proxy can't be used as an open geocoder by anonymous
  // callers; the rate limit still keys on IP (a single account behind one IP).
  // Accepts EITHER a mobile member (bearer token) OR a web-console staff/partner
  // principal (gt_staff cookie) — the admin/partner LocationPicker search box
  // runs in the cookie-authed console and has no bearer token.
  const me = await authedUser(req);
  const staff = me ? null : await staffFromCookie();
  if (!me && !staff) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'geo/search',
    limit: 10,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get('q') ?? undefined });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const key = parsed.data.q.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return json({ results: cached }, 200);

  let upstream: Response;
  try {
    const params = new URLSearchParams({
      q: parsed.data.q,
      format: 'jsonv2',
      limit: String(RESULT_CAP),
      addressdetails: '0',
    });
    upstream = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
  } catch {
    return json({ error: 'geocoder_unavailable' }, 502);
  }

  if (!upstream.ok) return json({ error: 'geocoder_unavailable' }, 502);

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return json({ error: 'geocoder_unavailable' }, 502);
  }

  const rows = z.array(nominatimHitSchema).safeParse(body);
  if (!rows.success) return json({ results: [] }, 200);

  const results: GeoResult[] = [];
  for (const hit of rows.data.slice(0, RESULT_CAP)) {
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    const point = latLngSchema.safeParse({ lat, lng });
    if (!point.success) continue; // drop unparseable / out-of-range coords
    results.push({ label: hit.display_name, lat: point.data.lat, lng: point.data.lng });
  }

  cacheSet(key, results);
  return json({ results }, 200);
}
