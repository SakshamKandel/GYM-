import { gyms } from '@gym/db';
import { distanceKm } from '@gym/shared';
import { and, asc, count, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { loadPhotosByGym, loadRatingAggregates, ratingFor } from './_lib';

export const runtime = 'nodejs';

/**
 * Public gym discovery list (plan §4). Unauthenticated — nearby gyms are a
 * public marketing surface, not member-gated data. Only rows that have
 * cleared BOTH the publish gate (`status='published'`) AND the admin
 * verification gate (`verifiedByAdmin=true`) are returned — the admin PATCH
 * route enforces the same pairing when a gym is published, so this filter is
 * defense-in-depth against a future write-side bug, not the only gate.
 *
 * `?lat&lng` (both required together) adds a `distanceKm` field per gym and
 * sorts nearest-first; omit either and the list falls back to name order.
 * `?q` does a simple ILIKE match against name/city.
 *
 * B16 fix: `?limit&offset` bound the query — previously this endpoint
 * returned the ENTIRE published+verified table on every load with no cap.
 * Response now also carries `total` so a client can render "N of M" / decide
 * whether to page further. Defaults are generous (50) so existing callers
 * that never pass `limit` keep seeing a full-feeling list while staying
 * bounded against unbounded table growth.
 *
 * B17 fix: `rating`/`reviewCount` are the REAL aggregate from visible
 * `gym_reviews` (see `_lib.ts`) — never the admin-authored columns.
 */

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const limited = rateLimit({
    route: 'gyms.list',
    limit: 60,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    lat: url.searchParams.get('lat') ?? undefined,
    lng: url.searchParams.get('lng') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { lat, lng, q, limit, offset } = parsed.data;

  const db = getDb();

  const where = and(
    eq(gyms.status, 'published'),
    eq(gyms.verifiedByAdmin, true),
    q
      ? or(
          ilike(gyms.name, `%${q.replace(/[\\%_]/g, '\\$&')}%`),
          ilike(gyms.city, `%${q.replace(/[\\%_]/g, '\\$&')}%`),
        )
      : undefined,
  );

  const [{ n: total }] = await db.select({ n: count() }).from(gyms).where(where);

  // Distance sort needs every matching row's coordinates to sort correctly
  // BEFORE paging — with lat/lng present we page in memory after sorting;
  // without an origin, sort/limit/offset all push down to SQL (cheap, no
  // full-table materialisation).
  const hasOrigin = lat !== undefined && lng !== undefined;

  const rows = hasOrigin
    ? await db
        .select({
          id: gyms.id,
          slug: gyms.slug,
          name: gyms.name,
          category: gyms.category,
          city: gyms.city,
          lat: gyms.lat,
          lng: gyms.lng,
        })
        .from(gyms)
        .where(where)
        .orderBy(asc(gyms.name))
    : await db
        .select({
          id: gyms.id,
          slug: gyms.slug,
          name: gyms.name,
          category: gyms.category,
          city: gyms.city,
          lat: gyms.lat,
          lng: gyms.lng,
        })
        .from(gyms)
        .where(where)
        .orderBy(asc(gyms.name))
        .limit(limit)
        .offset(offset);

  const withDistance = rows.map((r) => ({
    ...r,
    distanceKm:
      hasOrigin && r.lat !== null && r.lng !== null ? distanceKm({ lat, lng }, { lat: r.lat, lng: r.lng }) : null,
  }));

  if (hasOrigin) {
    withDistance.sort((a, b) => {
      if (a.distanceKm === null && b.distanceKm === null) return 0;
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }

  // Origin sort happened over the FULL matching set — page it now.
  const paged = hasOrigin ? withDistance.slice(offset, offset + limit) : withDistance;

  const ids = paged.map((r) => r.id);
  const [photosByGym, ratingByGym] = await Promise.all([
    loadPhotosByGym(ids),
    loadRatingAggregates(ids),
  ]);

  const gymCards = paged.map((r) => ({
    ...r,
    photos: photosByGym.get(r.id) ?? [],
    ...ratingFor(ratingByGym, r.id),
  }));

  return json({ gyms: gymCards, total, limit, offset }, 200);
}
