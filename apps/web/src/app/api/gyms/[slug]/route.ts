import { gyms } from '@gym/db';
import { gymPublicDetailResponseSchema } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import {
  loadFavoritedSet,
  loadPhotosByGym,
  loadRatingAggregates,
  publicAmenities,
  publicCoachIds,
  publicCrowdData,
  publicEquipment,
  publicHours,
  publicPassOptions,
  publicSocialLinks,
  ratingFor,
} from '../_lib';

export const runtime = 'nodejs';

/**
 * Public gym detail — one published + admin-verified gym, keyed by slug (the
 * mobile detail route is `/gyms/[slug]`, matching the schema's unique slug
 * column). 404 for drafts/archived/unverified rows so a client can't probe an
 * unpublished listing by guessing its slug.
 *
 * B17 fix: `rating`/`reviewCount` come from real `gym_reviews` (see `_lib.ts`)
 * — the admin-authored columns are never surfaced here. An OPTIONAL bearer
 * token (member only — a staff cookie is not accepted here, this is the
 * public surface) adds `isFavorited` so the detail screen can preload the
 * heart-icon state without a second round trip.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const limited = rateLimit({
      route: 'gyms.detail',
      limit: 60,
      windowMs: 60_000,
      ip: clientIp(req),
    });
    if (limited) return limited;

    const { slug } = await params;
    const db = getDb();

    const rows = await db
      .select({
        id: gyms.id,
        slug: gyms.slug,
        name: gyms.name,
        category: gyms.category,
        addressText: gyms.addressText,
        city: gyms.city,
        district: gyms.district,
        lat: gyms.lat,
        lng: gyms.lng,
        phone: gyms.phone,
        website: gyms.website,
        socialLinks: gyms.socialLinks,
        hours: gyms.hours,
        amenities: gyms.amenities,
        equipment: gyms.equipment,
        crowdData: gyms.crowdData,
        passOptions: gyms.passOptions,
        coachIds: gyms.coachIds,
        externalImageUrl: gyms.externalImageUrl,
        priceNote: gyms.priceNote,
        description: gyms.description,
      })
      .from(gyms)
      .where(and(eq(gyms.slug, slug), eq(gyms.status, 'published'), eq(gyms.verifiedByAdmin, true)))
      .limit(1);

    const row = rows[0];
    if (!row) return json({ error: 'not_found' }, 404);

    const [photosByGym, ratingByGym] = await Promise.all([
      loadPhotosByGym([row.id]),
      loadRatingAggregates([row.id]),
    ]);

    let isFavorited = false;
    const token = bearerToken(req);
    if (token) {
      const user = await userForToken(token);
      if (user) {
        const favorited = await loadFavoritedSet(user.id, [row.id]);
        isFavorited = favorited.has(row.id);
      }
    }

    const crowdData = publicCrowdData(row.crowdData);
    const gym = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      addressText: row.addressText,
      city: row.city,
      district: row.district,
      lat: row.lat,
      lng: row.lng,
      phone: row.phone,
      website: row.website,
      socialLinks: publicSocialLinks(row.socialLinks),
      hours: publicHours(row.hours),
      amenities: publicAmenities(row.amenities),
      equipment: publicEquipment(row.equipment),
      passOptions: publicPassOptions(row.passOptions),
      coachIds: publicCoachIds(row.coachIds),
      ...(crowdData ? { crowdData } : {}),
      externalImageUrl: row.externalImageUrl,
      priceNote: row.priceNote,
      description: row.description,
      photos: photosByGym.get(row.id) ?? [],
      isFavorited,
      ...ratingFor(ratingByGym, row.id),
    };

    const response = gymPublicDetailResponseSchema.safeParse({ gym });
    if (!response.success) {
      console.error('API /api/gyms/[slug] response validation failed:', response.error.issues);
      return json({ error: 'internal_error' }, 500);
    }

    return json(response.data, 200);
  } catch (err) {
    console.error('API /api/gyms/[slug] error:', err);
    return json({ error: 'internal_error' }, 500);
  }
}
