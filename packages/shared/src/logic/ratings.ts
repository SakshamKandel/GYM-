/**
 * Ratings pure logic — the 1-5 star schema and the partner/coach/gym aggregate.
 * No I/O (CLAUDE.md rule 10; plan §4 Pack C). The write-path authz (own the
 * order, order delivered, unique-per-order) lives in the route layer; here we
 * only validate the star value and fold rows into a display aggregate.
 */

import { z } from 'zod';

/** A 1-5 integer star rating. Rejects 0, 6, decimals, NaN. */
export const starsSchema = z.number().int().min(1).max(5);

/** Whether a raw value is a valid 1-5 integer star rating. */
export function isValidStars(stars: number): boolean {
  return starsSchema.safeParse(stars).success;
}

/** The minimal row shape an aggregate needs. */
export interface RatingRow {
  stars: number;
}

/** A rendered rating aggregate. `average` is rounded to one decimal. */
export interface RatingAggregate {
  average: number;
  count: number;
}

/**
 * Fold an already-summed set of valid stars into the display aggregate. This is
 * the ONE place the average is rounded and the never-rated case is decided, so
 * a database roll-up (`count(*)` + `sum(stars)` grouped per partner, filtered to
 * `stars between 1 and 5`) and the in-memory row fold below always produce the
 * same displayed number.
 *
 * `sumStars`/`count` must already EXCLUDE out-of-range stars — the SQL predicate
 * is what does that filtering for the grouped path.
 */
export function ratingAggregateFromTotals(sumStars: number, count: number): RatingAggregate {
  if (!Number.isFinite(count) || !Number.isFinite(sumStars) || count <= 0) {
    return { average: 0, count: 0 };
  }
  return { average: Math.round((sumStars / count) * 10) / 10, count };
}

/**
 * Fold rating rows into a partner (or coach/gym) aggregate. Invalid star values
 * are ignored (never crash on dirty data). Empty input → `{average:0,count:0}`
 * so a never-rated partner renders "no reviews yet", not NaN.
 */
export function partnerRatingAggregate(rows: readonly RatingRow[]): RatingAggregate {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    if (!isValidStars(row.stars)) continue;
    sum += row.stars;
    count += 1;
  }
  return ratingAggregateFromTotals(sum, count);
}

/**
 * Should a star average be shown at all? Discovery must not present a rating as
 * social proof until real reviews exist (Pack C) — gate display on a minimum
 * review count (product-tunable; default 1 = show as soon as one genuine review
 * lands, never on admin-authored numbers).
 */
export function shouldDisplayRating(count: number, minCount = 1): boolean {
  return count >= minCount;
}
