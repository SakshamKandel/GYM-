import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COACH_SPECIALTIES, containsPii, isCoachSpecialty, maskPii, PII_MASK } from './mentorship.ts';

describe('maskPii', () => {
  it('masks email addresses', () => {
    assert.equal(maskPii('write me at greece.m+vip@gmail.com ok'), `write me at ${PII_MASK} ok`);
  });

  it('masks international phone numbers with separators', () => {
    assert.equal(maskPii('call +977 98-4123-4567 tonight'), `call ${PII_MASK} tonight`);
    assert.equal(maskPii('my number is 9841234567'), `my number is ${PII_MASK}`);
    assert.equal(maskPii('(415) 555-2671'), PII_MASK);
  });

  it('masks social handles', () => {
    assert.equal(maskPii('dm me @greece_lifts on insta'), `dm me ${PII_MASK} on insta`);
  });

  it('leaves gym numbers alone', () => {
    const gym = 'Did 5x5 at 102.5kg, RPE 8. 2300 kcal, 180g protein. Rest 90s.';
    assert.equal(maskPii(gym), gym);
  });

  it('leaves years and short numbers alone', () => {
    const s = 'Since 2019 I squat 3x a week, best set 140x5 in 2024.';
    assert.equal(maskPii(s), s);
  });

  it('is idempotent', () => {
    const once = maskPii('email me a@b.co or 98412345678');
    assert.equal(maskPii(once), once);
  });

  it('containsPii flags only real hits', () => {
    assert.equal(containsPii('mail me x@y.dev'), true);
    assert.equal(containsPii('squat 100kg for 5'), false);
  });
});

describe('specialties', () => {
  it('catalog is non-empty and guard accepts members', () => {
    assert.ok(COACH_SPECIALTIES.length >= 10);
    assert.equal(isCoachSpecialty('hypertrophy'), true);
    assert.equal(isCoachSpecialty('astrology'), false);
  });
});
