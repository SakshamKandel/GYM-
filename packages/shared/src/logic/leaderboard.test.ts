import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  catchUpHint,
  competitionPositions,
  daysLeftInMonth,
  ordinalLabel,
} from './leaderboard.ts';

describe('ordinalLabel', () => {
  it('handles the standard suffixes', () => {
    assert.equal(ordinalLabel(1), '1st');
    assert.equal(ordinalLabel(2), '2nd');
    assert.equal(ordinalLabel(3), '3rd');
    assert.equal(ordinalLabel(4), '4th');
    assert.equal(ordinalLabel(21), '21st');
    assert.equal(ordinalLabel(42), '42nd');
    assert.equal(ordinalLabel(53), '53rd');
  });

  it('handles the 11/12/13 exception (and 111/112/113)', () => {
    assert.equal(ordinalLabel(11), '11th');
    assert.equal(ordinalLabel(12), '12th');
    assert.equal(ordinalLabel(13), '13th');
    assert.equal(ordinalLabel(111), '111th');
    assert.equal(ordinalLabel(112), '112th');
    assert.equal(ordinalLabel(113), '113th');
  });
});

describe('competitionPositions', () => {
  it('assigns 1224-style shared positions to ties', () => {
    assert.deepEqual(competitionPositions([9, 7, 7, 4]), [1, 2, 2, 4]);
  });

  it('is order-preserving for unsorted input', () => {
    assert.deepEqual(competitionPositions([4, 9, 7, 7]), [4, 1, 2, 2]);
  });

  it('all-tied entries share first place', () => {
    assert.deepEqual(competitionPositions([5, 5, 5]), [1, 1, 1]);
  });

  it('handles a single entry and empty input', () => {
    assert.deepEqual(competitionPositions([3]), [1]);
    assert.deepEqual(competitionPositions([]), []);
  });

  it('skips positions after a tie block', () => {
    assert.deepEqual(competitionPositions([8, 8, 8, 2, 1]), [1, 1, 1, 4, 5]);
  });
});

describe('catchUpHint', () => {
  it('targets the nearest count strictly above mine', () => {
    const hint = catchUpHint(4, [9, 7, 7, 4, 2]);
    assert.deepEqual(hint, { sessionsNeeded: 3, targetDays: 7, targetPosition: 2 });
  });

  it('returns null when leading', () => {
    assert.equal(catchUpHint(9, [9, 7, 4]), null);
  });

  it('returns null when tied for the lead', () => {
    assert.equal(catchUpHint(9, [9, 9, 4]), null);
  });

  it('needs exactly 1 session when one day behind', () => {
    const hint = catchUpHint(6, [7, 6, 2]);
    assert.deepEqual(hint, { sessionsNeeded: 1, targetDays: 7, targetPosition: 1 });
  });

  it('works when the caller is not on the board at all (0 days)', () => {
    const hint = catchUpHint(0, [3, 1]);
    assert.deepEqual(hint, { sessionsNeeded: 1, targetDays: 1, targetPosition: 2 });
  });
});

describe('daysLeftInMonth', () => {
  it('counts whole days after today', () => {
    assert.equal(daysLeftInMonth('2026-07-06'), 25); // July has 31 days
    assert.equal(daysLeftInMonth('2026-07-31'), 0);
    assert.equal(daysLeftInMonth('2026-07-30'), 1);
  });

  it('handles short months and leap February', () => {
    assert.equal(daysLeftInMonth('2026-02-27'), 1); // 2026 is not a leap year
    assert.equal(daysLeftInMonth('2028-02-27'), 2); // 2028 is a leap year
    assert.equal(daysLeftInMonth('2026-04-30'), 0);
  });

  it('returns 0 for malformed input', () => {
    assert.equal(daysLeftInMonth('not-a-date'), 0);
  });
});
