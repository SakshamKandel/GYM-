import { coachReviews } from '@gym/db';
import { ratingAggregateFromTotals, shouldDisplayRating } from '@gym/shared';
import { and, between, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

/**
 * Shared read helper for the member-facing coach surfaces — used by
 * GET /api/coaches (the discovery list) and GET /api/coaches/[id] (the
 * profile) so the two can never compute a coach's rating differently.
 *
 * Members have been able to rate their coach for a while (POST
 * /api/coaches/[id]/review), but nothing ever READ those rows — the reviews
 * were write-only. The count and sum come back already grouped from the
 * database and are folded with the SAME pure rounding the gym and meal-partner
 * ratings use (`ratingAggregateFromTotals` in @gym/shared), so all three
 * verticals round and count identically.
 *
 * Display gate: a coach shows NO rating at all until `MIN_PUBLIC_REVIEWS`
 * genuine reviews exist, so discovery never presents "5.0 (1)" as social
 * proof (Pack C). Below the threshold the aggregate is simply `null` — the
 * count is withheld too, so nobody can infer a single member's private score
 * from a public card.
 */

/** Reviews needed before a coach's star average is shown publicly. */
const MIN_PUBLIC_REVIEWS = 3;

export interface CoachRatingAgg {
  rating: number | null;
  reviewCount: number | null;
}

const NO_COACH_RATING: CoachRatingAgg = { rating: null, reviewCount: null };

/**
 * Real rating aggregate per coach id. Coaches below the display threshold (or
 * with no reviews at all) are absent from the map — callers default to
 * `NO_COACH_RATING`.
 *
 * One grouped aggregate, not one row per review: the discovery list used to
 * pull every `coach_reviews` row for every coach on the page and average them
 * in JavaScript, so a long-tenured coach's whole review history crossed the
 * wire on each browse. `between 1 and 5` is the same out-of-range guard the old
 * client-side fold applied (the column is an integer, so range is the only way
 * a star value can be invalid).
 */
export async function loadCoachRatings(coachIds: string[]): Promise<Map<string, CoachRatingAgg>> {
  const out = new Map<string, CoachRatingAgg>();
  if (coachIds.length === 0) return out;

  const rows = await getDb()
    .select({
      coachId: coachReviews.coachId,
      reviewCount: sql<number>`count(*)::int`,
      sumStars: sql<number>`coalesce(sum(${coachReviews.stars}), 0)::int`,
    })
    .from(coachReviews)
    .where(and(inArray(coachReviews.coachId, coachIds), between(coachReviews.stars, 1, 5)))
    .groupBy(coachReviews.coachId);

  for (const row of rows) {
    const agg = ratingAggregateFromTotals(Number(row.sumStars), Number(row.reviewCount));
    if (!shouldDisplayRating(agg.count, MIN_PUBLIC_REVIEWS)) continue;
    out.set(row.coachId, { rating: agg.average, reviewCount: agg.count });
  }
  return out;
}

export function coachRatingFor(agg: Map<string, CoachRatingAgg>, coachId: string): CoachRatingAgg {
  return agg.get(coachId) ?? NO_COACH_RATING;
}
