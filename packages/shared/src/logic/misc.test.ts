import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasEntitlement, minTierFor } from './entitlements.ts';
import { platesFor } from './plates.ts';
import { streakAlive, updateStreak } from './streak.ts';
import { displayWeight, inputToKg, kgToLb, lbToKg } from './units.ts';

describe('entitlements (Feature Blueprint §05)', () => {
  it('higher tiers include lower-tier features', () => {
    assert.equal(hasEntitlement({ tier: 'elite' }, 'basic_logging'), true);
    assert.equal(hasEntitlement({ tier: 'gold' }, 'food_suggestions'), true);
  });
  it('silver unlocks suggestions/photos, gold unlocks the GM method', () => {
    assert.equal(hasEntitlement({ tier: 'starter' }, 'food_suggestions'), false);
    assert.equal(hasEntitlement({ tier: 'silver' }, 'food_suggestions'), true);
    assert.equal(hasEntitlement({ tier: 'silver' }, 'signature_plans'), false);
    assert.equal(hasEntitlement({ tier: 'gold' }, 'adaptive_progression'), true);
    assert.equal(hasEntitlement({ tier: 'gold' }, 'coach_chat'), false);
    assert.equal(minTierFor('coach_chat'), 'elite');
  });
});

describe('platesFor', () => {
  it('loads 100kg as 25+15 per side on a 20kg bar', () => {
    const r = platesFor(100);
    assert.deepEqual(r.perSide, [25, 15]);
    assert.equal(r.remainder, 0);
    assert.equal(r.achievableKg, 100);
  });
  it('reports unreachable remainders', () => {
    const r = platesFor(101); // 0.5/side can't be loaded with 1.25 minimum
    assert.equal(r.achievableKg, 100);
    assert.ok(r.remainder > 0);
  });
  it('bar-only and below-bar weights load nothing', () => {
    assert.deepEqual(platesFor(20).perSide, []);
    assert.deepEqual(platesFor(10).perSide, []);
  });
});

describe('streak', () => {
  const empty = { current: 0, best: 0, lastWorkoutDate: null };
  it('first workout starts the streak', () => {
    const s = updateStreak(empty, '2026-07-01');
    assert.equal(s.current, 1);
  });
  it('training within grace continues it', () => {
    let s = updateStreak(empty, '2026-07-01');
    s = updateStreak(s, '2026-07-04'); // 3-day gap = grace 2 + 1
    assert.equal(s.current, 2);
  });
  it('a long gap resets to 1 but keeps best', () => {
    let s = updateStreak(empty, '2026-07-01');
    s = updateStreak(s, '2026-07-04');
    s = updateStreak(s, '2026-07-20');
    assert.equal(s.current, 1);
    assert.equal(s.best, 2);
  });
  it('same-day double workout does not double-count', () => {
    let s = updateStreak(empty, '2026-07-01');
    s = updateStreak(s, '2026-07-01');
    assert.equal(s.current, 1);
  });
  it('streakAlive respects the grace window', () => {
    const s = updateStreak(empty, '2026-07-01');
    assert.equal(streakAlive(s, '2026-07-04'), true);
    assert.equal(streakAlive(s, '2026-07-05'), false);
  });
});

describe('units', () => {
  it('round-trips kg↔lb within rounding', () => {
    assert.ok(Math.abs(lbToKg(kgToLb(100)) - 100) < 0.05);
  });
  it('displayWeight and inputToKg respect the pref', () => {
    assert.equal(displayWeight(100, 'kg'), 100);
    assert.equal(displayWeight(100, 'lb'), 220.5);
    assert.equal(inputToKg(220.5, 'lb'), 100.02);
  });
});
