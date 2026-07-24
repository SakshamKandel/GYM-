import { gymFavorites, gymPhotos, gymReviews, gyms } from '@gym/db';
import {
  GYM_AMENITIES,
  gymCrowdStatusSchema,
  gymEquipmentItemSchema,
  gymPassOptionSchema,
  gymSocialLinkSchema,
  gymWeeklyHoursSchema,
  partnerRatingAggregate,
  type GymAmenity,
  type GymCrowdStatus,
  type GymEquipmentItem,
  type GymPassOption,
  type GymSocialLink,
  type GymWeeklyHours,
} from '@gym/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';

/**
 * Shared read helpers for the public gym-discovery surface (Pack M / plan
 * §5 WP-11) — used by GET /api/gyms, GET /api/gyms/[slug], and
 * GET /api/gyms/favorites so the three never compute a gym's rating or photo
 * set differently.
 *
 * B17 fix: a gym's displayed `rating`/`reviewCount` are computed HERE, from
 * real `gym_reviews` rows (status='visible' only) via the shared
 * `partnerRatingAggregate` fold (same pure function the meal-partner rating
 * uses — `RatingRow` is generic). The admin-authored `gyms.rating` /
 * `gyms.reviewCount` columns are intentionally never read by these routes
 * again: a gym shows NO rating/count at all until it has at least one genuine
 * member review (Pack C — "stop rendering admin numbers as social proof").
 */

export interface GymRatingAgg {
  rating: number | null;
  reviewCount: number | null;
}

const NO_RATING: GymRatingAgg = { rating: null, reviewCount: null };

/** Real rating aggregate per gym id, keyed by gym id. Gyms with zero visible
 * reviews are simply absent from the map (callers default to NO_RATING). */
export async function loadRatingAggregates(gymIds: string[]): Promise<Map<string, GymRatingAgg>> {
  const out = new Map<string, GymRatingAgg>();
  if (gymIds.length === 0) return out;

  const rows = await getDb()
    .select({ gymId: gymReviews.gymId, stars: gymReviews.stars })
    .from(gymReviews)
    .where(and(inArray(gymReviews.gymId, gymIds), eq(gymReviews.status, 'visible')));

  const byGym = new Map<string, { stars: number }[]>();
  for (const r of rows) {
    const list = byGym.get(r.gymId) ?? [];
    list.push({ stars: r.stars });
    byGym.set(r.gymId, list);
  }
  for (const [gymId, gymRows] of byGym) {
    const agg = partnerRatingAggregate(gymRows);
    if (agg.count > 0) out.set(gymId, { rating: agg.average, reviewCount: agg.count });
  }
  return out;
}

export function ratingFor(agg: Map<string, GymRatingAgg>, gymId: string): GymRatingAgg {
  return agg.get(gymId) ?? NO_RATING;
}

/** Cover photos per gym id, sorted by `sortOrder` (ascending). */
export async function loadPhotosByGym(
  gymIds: string[],
): Promise<Map<string, { id: string; deliveryUrl: string }[]>> {
  const out = new Map<string, { id: string; deliveryUrl: string }[]>();
  if (gymIds.length === 0) return out;

  const rows = await getDb()
    .select({ id: gymPhotos.id, gymId: gymPhotos.gymId, deliveryUrl: gymPhotos.deliveryUrl, sortOrder: gymPhotos.sortOrder })
    .from(gymPhotos)
    .where(inArray(gymPhotos.gymId, gymIds))
    .orderBy(asc(gymPhotos.sortOrder));
  for (const p of rows) {
    const list = out.get(p.gymId) ?? [];
    list.push({ id: p.id, deliveryUrl: p.deliveryUrl });
    out.set(p.gymId, list);
  }
  return out;
}

/** Invalid operator-authored JSON is treated as unavailable, never replaced
 * with plausible-looking client data. Valid items are preserved verbatim. */
export function publicEquipment(value: unknown): GymEquipmentItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = gymEquipmentItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function publicCrowdData(value: unknown): GymCrowdStatus | undefined {
  const parsed = gymCrowdStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function publicPassOptions(value: unknown): GymPassOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = gymPassOptionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function publicSocialLinks(value: unknown): GymSocialLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = gymSocialLinkSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function publicHours(value: unknown): GymWeeklyHours {
  const parsed = gymWeeklyHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

const KNOWN_AMENITIES = new Set<string>(GYM_AMENITIES);

export function publicAmenities(value: unknown): GymAmenity[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is GymAmenity => typeof item === 'string' && KNOWN_AMENITIES.has(item),
  );
}

export function publicCoachIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** Which of `gymIds` the given account has favorited. Empty set for a signed-
 * out caller (never queried — callers should skip when `accountId` is null). */
export async function loadFavoritedSet(accountId: string, gymIds: string[]): Promise<Set<string>> {
  if (gymIds.length === 0) return new Set();
  const rows = await getDb()
    .select({ gymId: gymFavorites.gymId })
    .from(gymFavorites)
    .where(and(eq(gymFavorites.accountId, accountId), inArray(gymFavorites.gymId, gymIds)));
  return new Set(rows.map((r) => r.gymId));
}

/** One published + admin-verified gym row by id (internal helper — every
 * WRITE route re-checks this pairing so a draft/archived gym can never be
 * reviewed/reported/enquired-about, or newly FAVORITED, via a stale slug). */
export async function publishedGymBySlug(
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await getDb()
    .select({ id: gyms.id, name: gyms.name })
    .from(gyms)
    .where(and(eq(gyms.slug, slug), eq(gyms.status, 'published'), eq(gyms.verifiedByAdmin, true)))
    .limit(1);
  return rows[0] ?? null;
}

/** Any gym row by slug, regardless of publish/verification status. Used ONLY
 * for un-favoriting: a gym the admin later archives must stay removable from
 * a member's shortlist, not get stuck because the publish gate 404s it. */
export async function gymBySlugAnyStatus(slug: string): Promise<{ id: string } | null> {
  const rows = await getDb().select({ id: gyms.id }).from(gyms).where(eq(gyms.slug, slug)).limit(1);
  return rows[0] ?? null;
}
