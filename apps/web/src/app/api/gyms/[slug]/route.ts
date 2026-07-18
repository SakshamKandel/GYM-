import { gymPhotos, gyms } from '@gym/db';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Public gym detail — one published + admin-verified gym, keyed by slug (the
 * mobile detail route is `/gyms/[slug]`, matching the schema's unique slug
 * column). 404 for drafts/archived/unverified rows so a client can't probe an
 * unpublished listing by guessing its slug.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
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
    .select()
    .from(gyms)
    .where(and(eq(gyms.slug, slug), eq(gyms.status, 'published'), eq(gyms.verifiedByAdmin, true)))
    .limit(1);

  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  const photos = await db
    .select({ id: gymPhotos.id, deliveryUrl: gymPhotos.deliveryUrl })
    .from(gymPhotos)
    .where(eq(gymPhotos.gymId, row.id))
    .orderBy(asc(gymPhotos.sortOrder));

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
    socialLinks: row.socialLinks,
    hours: row.hours,
    amenities: row.amenities,
    externalImageUrl: row.externalImageUrl,
    priceNote: row.priceNote,
    description: row.description,
    rating: row.rating,
    reviewCount: row.reviewCount,
    photos,
  };

  return json({ gym }, 200);
}
