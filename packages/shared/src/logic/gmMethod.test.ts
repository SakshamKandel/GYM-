import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GM_TIERS, TIER_ORDER, gmPhaseForWeek, gmWeeklyAdjustment } from './gmMethod.ts';

describe('GM_TIERS', () => {
  it('catalog follows the tier ladder order', () => {
    assert.deepEqual(
      GM_TIERS.map((t) => t.tier),
      TIER_ORDER,
    );
  });
  it('starter is free and prices climb strictly', () => {
    assert.equal(GM_TIERS[0]!.pricePerMonthNpr, 0);
    for (let i = 1; i < GM_TIERS.length; i++) {
      assert.ok(GM_TIERS[i]!.pricePerMonthNpr > GM_TIERS[i - 1]!.pricePerMonthNpr);
    }
  });
  it('every tier sells at least one feature', () => {
    for (const t of GM_TIERS) assert.ok(t.features.length > 0);
  });
});

/** bodyweight 100 kg makes trendRatePerWeekKg read directly as %/week. */
const base = { bodyweightKg: 100, currentKcal: 2000, baseKcal: 2000 };

describe('gmWeeklyAdjustment — fat loss band (−0.8..−0.4 %/wk)', () => {
  it('in-band rate leaves calories unchanged', () => {
    const r = gmWeeklyAdjustment({ ...base, goal: 'fat_loss', trendRatePerWeekKg: -0.6 });
    assert.equal(r.newKcal, 2000);
    assert.equal(r.changed, false);
    assert.equal(r.reason, 'On track — stay the course');
  });
  it('band edges are inclusive (no change at exactly −0.8 or −0.4)', () => {
    assert.equal(
      gmWeeklyAdjustment({ ...base, goal: 'fat_loss', trendRatePerWeekKg: -0.8 }).changed,
      false,
    );
    assert.equal(
      gmWeeklyAdjustment({ ...base, goal: 'fat_loss', trendRatePerWeekKg: -0.4 }).changed,
      false,
    );
  });
  it('losing faster than −0.8%/wk adds 5% to protect muscle', () => {
    const r = gmWeeklyAdjustment({ ...base, goal: 'fat_loss', trendRatePerWeekKg: -1.0 });
    assert.equal(r.newKcal, 2100);
    assert.equal(r.changed, true);
    assert.match(r.reason, /adding fuel to protect muscle/);
  });
  it('stalling (or gaining) trims 5%', () => {
    const r = gmWeeklyAdjustment({ ...base, goal: 'fat_loss', trendRatePerWeekKg: 0.2 });
    assert.equal(r.newKcal, 1900);
    assert.equal(r.changed, true);
    assert.match(r.reason, /trimming calories/);
  });
});

describe('gmWeeklyAdjustment — muscle band (+0.1..+0.4 %/wk)', () => {
  it('band edges are inclusive', () => {
    assert.equal(
      gmWeeklyAdjustment({ ...base, goal: 'muscle', trendRatePerWeekKg: 0.1 }).changed,
      false,
    );
    assert.equal(
      gmWeeklyAdjustment({ ...base, goal: 'muscle', trendRatePerWeekKg: 0.4 }).changed,
      false,
    );
  });
  it('gaining too fast trims 4% (then rounds to 25)', () => {
    const r = gmWeeklyAdjustment({ ...base, goal: 'muscle', trendRatePerWeekKg: 0.5 });
    assert.equal(r.newKcal, 1925); // 2000 × 0.96 = 1920 → nearest 25
  });
  it('flat scale adds 4% to restart gains (then rounds to 25)', () => {
    const r = gmWeeklyAdjustment({ ...base, goal: 'muscle', trendRatePerWeekKg: 0 });
    assert.equal(r.newKcal, 2075); // 2000 × 1.04 = 2080 → nearest 25
  });
});

describe('gmWeeklyAdjustment — strength band (−0.2..+0.3 %/wk)', () => {
  it('holding steady stays unchanged', () => {
    assert.equal(
      gmWeeklyAdjustment({ ...base, goal: 'strength', trendRatePerWeekKg: 0 }).changed,
      false,
    );
  });
  it('nudges ±3% back toward the band (then rounds to 25)', () => {
    assert.equal(
      gmWeeklyAdjustment({ ...base, goal: 'strength', trendRatePerWeekKg: 0.4 }).newKcal,
      1950, // 2000 × 0.97 = 1940 → nearest 25
    );
    assert.equal(
      gmWeeklyAdjustment({ ...base, goal: 'strength', trendRatePerWeekKg: -0.3 }).newKcal,
      2050, // 2000 × 1.03 = 2060 → nearest 25
    );
  });
});

describe('gmWeeklyAdjustment — clamps, floor and rounding', () => {
  it('never drifts above +20% of baseKcal', () => {
    // +4% of 2400 would be 2496, but base 2000 caps drift at 2400.
    const r = gmWeeklyAdjustment({
      goal: 'muscle',
      bodyweightKg: 100,
      trendRatePerWeekKg: 0,
      currentKcal: 2400,
      baseKcal: 2000,
    });
    assert.equal(r.newKcal, 2400);
    assert.equal(r.changed, false); // clamp cancelled the nudge
  });
  it('never drifts below −20% of baseKcal', () => {
    const r = gmWeeklyAdjustment({
      goal: 'fat_loss',
      bodyweightKg: 100,
      trendRatePerWeekKg: 0, // stalling → −5%
      currentKcal: 1600,
      baseKcal: 2000,
    });
    assert.equal(r.newKcal, 1600);
    assert.equal(r.changed, false);
  });
  it('never goes below the 1200 kcal floor', () => {
    const r = gmWeeklyAdjustment({
      goal: 'fat_loss',
      bodyweightKg: 45,
      trendRatePerWeekKg: 0, // stalling → −5% of 1230 = 1168.5
      currentKcal: 1230,
      baseKcal: 1250,
    });
    assert.equal(r.newKcal, 1200);
  });
  it('rounds to the nearest 25 kcal', () => {
    const r = gmWeeklyAdjustment({
      goal: 'fat_loss',
      bodyweightKg: 100,
      trendRatePerWeekKg: -1.0, // too fast → +5% of 2010 = 2110.5
      currentKcal: 2010,
      baseKcal: 2010,
    });
    assert.equal(r.newKcal, 2100);
    assert.equal(r.newKcal % 25, 0);
  });
});

describe('gmPhaseForWeek', () => {
  it('muscle/strength cycle 3 build weeks then a deload, forever', () => {
    for (const goal of ['muscle', 'strength'] as const) {
      for (const week of [1, 2, 3, 5, 6, 7]) {
        const p = gmPhaseForWeek(week, goal);
        assert.equal(p.kind, 'build');
        assert.equal(p.volumeMultiplier, 1);
      }
      for (const week of [4, 8]) {
        const p = gmPhaseForWeek(week, goal);
        assert.equal(p.kind, 'deload');
        assert.equal(p.volumeMultiplier, 0.6);
        assert.equal(p.note, 'Deload — move light, recover hard');
      }
    }
  });
  it('fat loss swaps the deload for a maintenance diet break', () => {
    for (const week of [1, 2, 3, 5, 6, 7]) {
      const p = gmPhaseForWeek(week, 'fat_loss');
      assert.equal(p.kind, 'build');
      assert.equal(p.volumeMultiplier, 1);
    }
    for (const week of [4, 8]) {
      const p = gmPhaseForWeek(week, 'fat_loss');
      assert.equal(p.kind, 'dietBreak');
      assert.equal(p.volumeMultiplier, 1);
      assert.equal(p.note, 'Diet break — eat at maintenance this week');
    }
  });
  it('build weeks label their position in the block', () => {
    assert.equal(gmPhaseForWeek(6, 'muscle').label, 'Build week 2 of 3');
    assert.equal(gmPhaseForWeek(1, 'fat_loss').label, 'Deficit week 1 of 3');
  });
});
