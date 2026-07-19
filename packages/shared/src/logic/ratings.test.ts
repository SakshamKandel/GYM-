import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isValidStars,
  partnerRatingAggregate,
  shouldDisplayRating,
  starsSchema,
} from './ratings.ts';

describe('starsSchema / isValidStars', () => {
  it('accepts integers 1-5', () => {
    for (const s of [1, 2, 3, 4, 5]) {
      assert.equal(starsSchema.safeParse(s).success, true);
      assert.equal(isValidStars(s), true);
    }
  });
  it('rejects 0, 6, decimals and NaN', () => {
    for (const s of [0, 6, 3.5, Number.NaN, -1, 100]) {
      assert.equal(isValidStars(s), false);
    }
  });
});

describe('partnerRatingAggregate', () => {
  it('returns zero aggregate for no rows', () => {
    assert.deepEqual(partnerRatingAggregate([]), { average: 0, count: 0 });
  });
  it('averages valid stars and rounds to one decimal', () => {
    // (5+4+4)/3 = 4.333… → 4.3
    assert.deepEqual(partnerRatingAggregate([{ stars: 5 }, { stars: 4 }, { stars: 4 }]), {
      average: 4.3,
      count: 3,
    });
  });
  it('ignores invalid star rows without crashing', () => {
    const agg = partnerRatingAggregate([{ stars: 5 }, { stars: 0 }, { stars: 3.5 }, { stars: 3 }]);
    assert.deepEqual(agg, { average: 4, count: 2 });
  });
});

describe('shouldDisplayRating', () => {
  it('hides until the minimum review count', () => {
    assert.equal(shouldDisplayRating(0), false);
    assert.equal(shouldDisplayRating(1), true);
    assert.equal(shouldDisplayRating(2, 3), false);
    assert.equal(shouldDisplayRating(3, 3), true);
  });
});
