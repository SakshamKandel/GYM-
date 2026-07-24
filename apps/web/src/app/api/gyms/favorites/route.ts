import { gymFavorites, gyms } from '@gym/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { loadPhotosByGym, loadRatingAggregates, ratingFor } from '../_lib';

export const runtime = 'nodejs';

/**
 * The caller's saved/shortlisted gyms (Pack M — powers `/gyms/saved`).
 * Member-only. A gym the admin later archives/unpublishes still appears here
 * (so a member's shortlist doesn't silently shrink) but is flagged
 * `unavailable: true` so the client can grey it out / hide its "View" CTA
 * rather than link into a 404.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'gyms.favorites.list',
    limit: 30,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const db = getDb();

  const favRows = await db
    .select({ gymId: gymFavorites.gymId, savedAt: gymFavorites.createdAt })
    .from(gymFavorites)
    .where(eq(gymFavorites.accountId, user.id))
    .orderBy(desc(gymFavorites.createdAt));
  if (favRows.length === 0) return json({ gyms: [] }, 200);

  const gymIds = favRows.map((f) => f.gymId);
  const gymRows = await db
    .select({
      id: gyms.id,
      slug: gyms.slug,
      name: gyms.name,
      category: gyms.category,
      city: gyms.city,
      lat: gyms.lat,
      lng: gyms.lng,
      status: gyms.status,
      verifiedByAdmin: gyms.verifiedByAdmin,
    })
    .from(gyms)
    .where(inArray(gyms.id, gymIds));
  const gymById = new Map(gymRows.map((g) => [g.id, g]));

  const [photosByGym, ratingByGym] = await Promise.all([
    loadPhotosByGym(gymIds),
    loadRatingAggregates(gymIds),
  ]);

  const savedAtByGym = new Map(favRows.map((f) => [f.gymId, f.savedAt]));
  const out = favRows
    .map((f) => gymById.get(f.gymId))
    .filter((g): g is NonNullable<typeof g> => g !== undefined)
    .map((g) => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      category: g.category,
      city: g.city,
      lat: g.lat,
      lng: g.lng,
      distanceKm: null as number | null,
      photos: (photosByGym.get(g.id) ?? []).map(({ deliveryUrl }) => ({ deliveryUrl })),
      ...ratingFor(ratingByGym, g.id),
      unavailable: !(g.status === 'published' && g.verifiedByAdmin),
      savedAt: savedAtByGym.get(g.id)?.toISOString() ?? null,
    }));

  return json({ gyms: out }, 200);
}
