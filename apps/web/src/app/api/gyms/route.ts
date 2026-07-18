import { gymPhotos, gyms } from '@gym/db';
import { distanceKm } from '@gym/shared';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

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
 */

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  q: z.string().trim().max(200).optional(),
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
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { lat, lng, q } = parsed.data;

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

  const rows = await db
    .select({
      id: gyms.id,
      slug: gyms.slug,
      name: gyms.name,
      category: gyms.category,
      city: gyms.city,
      lat: gyms.lat,
      lng: gyms.lng,
      rating: gyms.rating,
      reviewCount: gyms.reviewCount,
    })
    .from(gyms)
    .where(where)
    .orderBy(asc(gyms.name));

  const ids = rows.map((r) => r.id);
  const photosByGym = new Map<string, { deliveryUrl: string }[]>();
  if (ids.length > 0) {
    const photoRows = await db
      .select({ gymId: gymPhotos.gymId, deliveryUrl: gymPhotos.deliveryUrl, sortOrder: gymPhotos.sortOrder })
      .from(gymPhotos)
      .where(inArray(gymPhotos.gymId, ids))
      .orderBy(asc(gymPhotos.sortOrder));
    for (const p of photoRows) {
      const list = photosByGym.get(p.gymId) ?? [];
      list.push({ deliveryUrl: p.deliveryUrl });
      photosByGym.set(p.gymId, list);
    }
  }

  const hasOrigin = lat !== undefined && lng !== undefined;
  const withDistance = rows.map((r) => ({
    ...r,
    photos: photosByGym.get(r.id) ?? [],
    distanceKm:
      hasOrigin && r.lat !== null && r.lng !== null
        ? distanceKm({ lat, lng }, { lat: r.lat, lng: r.lng })
        : null,
  }));

  if (hasOrigin) {
    withDistance.sort((a, b) => {
      if (a.distanceKm === null && b.distanceKm === null) return 0;
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }

  return json({ gyms: withDistance }, 200);
}
