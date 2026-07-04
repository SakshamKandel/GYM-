import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  balanceVerdict,
  consistencyStats,
  detectPlateau,
  kcalAdherence,
  LEG_MUSCLES,
  MUSCLE_TARGET_BAND,
  proteinHitRate,
  PULL_MUSCLES,
  PUSH_MUSCLES,
  pushPullRatio,
  weeklySetsPerMuscle,
  weeklyTonnage,
  weekStartIso,
  type DailyMacros,
} from './analytics.ts';

describe('weekStartIso', () => {
  it('returns the Monday of the containing week', () => {
    assert.equal(weekStartIso('2026-07-01'), '2026-06-29'); // Wednesday → Monday
    assert.equal(weekStartIso('2026-07-05'), '2026-06-29'); // Sunday → previous Monday
  });
  it('is a fixed point on Monday itself', () => {
    assert.equal(weekStartIso('2026-06-29'), '2026-06-29');
  });
  it('supports Sunday-start weeks', () => {
    assert.equal(weekStartIso('2026-07-01', false), '2026-06-28');
    assert.equal(weekStartIso('2026-06-28', false), '2026-06-28');
  });
  it('crosses month and year boundaries', () => {
    assert.equal(weekStartIso('2026-01-01'), '2025-12-29');
  });
});

describe('weeklyTonnage', () => {
  const today = '2026-07-04'; // Saturday; week starts 2026-06-29
  it('zero-fills empty weeks, oldest first', () => {
    const out = weeklyTonnage([], 3, today);
    assert.deepEqual(out, [
      { weekStartIso: '2026-06-15', tonnageKg: 0, setCount: 0 },
      { weekStartIso: '2026-06-22', tonnageKg: 0, setCount: 0 },
      { weekStartIso: '2026-06-29', tonnageKg: 0, setCount: 0 },
    ]);
  });
  it('sums weight × reps and counts sets per week', () => {
    const sets = [
      { workoutDate: '2026-06-30', weightKg: 100, reps: 5 }, // current week
      { workoutDate: '2026-07-02', weightKg: 60, reps: 10 }, // current week
      { workoutDate: '2026-06-23', weightKg: 80, reps: 8 }, // prior week
    ];
    const out = weeklyTonnage(sets, 2, today);
    assert.deepEqual(out, [
      { weekStartIso: '2026-06-22', tonnageKg: 640, setCount: 1 },
      { weekStartIso: '2026-06-29', tonnageKg: 1100, setCount: 2 },
    ]);
  });
  it('ignores sets outside the window', () => {
    const out = weeklyTonnage([{ workoutDate: '2026-06-01', weightKg: 100, reps: 5 }], 1, today);
    assert.deepEqual(out, [{ weekStartIso: '2026-06-29', tonnageKg: 0, setCount: 0 }]);
  });
  it('handles a single week', () => {
    const out = weeklyTonnage([{ workoutDate: today, weightKg: 50, reps: 2 }], 1, today);
    assert.deepEqual(out, [{ weekStartIso: '2026-06-29', tonnageKg: 100, setCount: 1 }]);
  });
  it('returns empty for zero weeks', () => {
    assert.deepEqual(weeklyTonnage([], 0, today), []);
  });
});

describe('weeklySetsPerMuscle', () => {
  const week = '2026-06-29';
  it('counts 1.0 primary and 0.5 per secondary, sorted desc', () => {
    const sets = [
      { workoutDate: '2026-06-29', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'] },
      { workoutDate: '2026-07-01', primaryMuscle: 'chest', secondaryMuscles: ['triceps'] },
      { workoutDate: '2026-07-03', primaryMuscle: 'triceps', secondaryMuscles: [] },
    ];
    assert.deepEqual(weeklySetsPerMuscle(sets, week), [
      { muscle: 'chest', hardSets: 2 },
      { muscle: 'triceps', hardSets: 2 },
      { muscle: 'shoulders', hardSets: 0.5 },
    ]);
  });
  it('excludes sets outside the week (7-day window)', () => {
    const sets = [
      { workoutDate: '2026-06-28', primaryMuscle: 'lats', secondaryMuscles: [] }, // Sunday before
      { workoutDate: '2026-07-06', primaryMuscle: 'lats', secondaryMuscles: [] }, // Monday after
      { workoutDate: '2026-07-05', primaryMuscle: 'biceps', secondaryMuscles: [] }, // last day, in
    ];
    assert.deepEqual(weeklySetsPerMuscle(sets, week), [{ muscle: 'biceps', hardSets: 1 }]);
  });
  it('returns empty for no sets', () => {
    assert.deepEqual(weeklySetsPerMuscle([], week), []);
  });
  it('breaks ties alphabetically', () => {
    const sets = [
      { workoutDate: '2026-06-30', primaryMuscle: 'quadriceps', secondaryMuscles: [] },
      { workoutDate: '2026-06-30', primaryMuscle: 'glutes', secondaryMuscles: [] },
    ];
    assert.deepEqual(
      weeklySetsPerMuscle(sets, week).map((m) => m.muscle),
      ['glutes', 'quadriceps'],
    );
  });
});

describe('balanceVerdict', () => {
  it('follows the 10–20 hard-set band', () => {
    assert.equal(MUSCLE_TARGET_BAND.min, 10);
    assert.equal(MUSCLE_TARGET_BAND.max, 20);
    assert.equal(balanceVerdict(9.5), 'low');
    assert.equal(balanceVerdict(10), 'inRange');
    assert.equal(balanceVerdict(20), 'inRange');
    assert.equal(balanceVerdict(20.5), 'high');
    assert.equal(balanceVerdict(0), 'low');
  });
});

describe('muscle groups', () => {
  it('cover the free-exercise-db names without overlap', () => {
    const all = [...PUSH_MUSCLES, ...PULL_MUSCLES, ...LEG_MUSCLES];
    assert.equal(new Set(all).size, all.length);
    assert.equal(PUSH_MUSCLES.length, 3);
    assert.equal(PULL_MUSCLES.length, 5);
    assert.equal(LEG_MUSCLES.length, 6);
  });
});

describe('pushPullRatio', () => {
  it('is push volume over pull volume', () => {
    const ratio = pushPullRatio([
      { muscle: 'chest', hardSets: 10 },
      { muscle: 'triceps', hardSets: 5 },
      { muscle: 'lats', hardSets: 10 },
    ]);
    assert.equal(ratio, 1.5);
  });
  it('ignores legs, core, and unknown muscles', () => {
    const ratio = pushPullRatio([
      { muscle: 'chest', hardSets: 8 },
      { muscle: 'lats', hardSets: 8 },
      { muscle: 'quadriceps', hardSets: 20 },
      { muscle: 'abdominals', hardSets: 12 },
      { muscle: 'not a muscle', hardSets: 99 },
    ]);
    assert.equal(ratio, 1);
  });
  it('is null when pull volume is zero', () => {
    assert.equal(pushPullRatio([{ muscle: 'chest', hardSets: 10 }]), null);
    assert.equal(pushPullRatio([]), null);
  });
});

describe('consistencyStats', () => {
  const today = '2026-07-04'; // Saturday; week starts 2026-06-29
  it('buckets sessions per week, zero-filled oldest first', () => {
    const stats = consistencyStats(
      ['2026-06-22', '2026-06-24', '2026-06-30'], // Mon, Wed prior week; Tue current week
      3,
      today,
      3,
    );
    assert.deepEqual(stats.perWeek, [
      { weekStartIso: '2026-06-15', sessions: 0 },
      { weekStartIso: '2026-06-22', sessions: 2 },
      { weekStartIso: '2026-06-29', sessions: 1 },
    ]);
    assert.equal(stats.avgPerWeek, 1);
    assert.equal(stats.adherencePct, 33);
  });
  it('caps adherence at 100', () => {
    const stats = consistencyStats(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'], 1, today, 2);
    assert.equal(stats.avgPerWeek, 4);
    assert.equal(stats.adherencePct, 100);
  });
  it('counts sessions by weekday, Monday first', () => {
    const stats = consistencyStats(['2026-06-29', '2026-07-01', '2026-07-05'], 1, today, 3);
    // Mon, Wed, Sun of the current week
    assert.deepEqual(stats.dayOfWeekCounts, [1, 0, 1, 0, 0, 0, 1]);
  });
  it('ignores dates outside the window', () => {
    const stats = consistencyStats(['2026-01-05'], 2, today, 3);
    assert.equal(stats.avgPerWeek, 0);
    assert.deepEqual(stats.dayOfWeekCounts, [0, 0, 0, 0, 0, 0, 0]);
  });
  it('handles empty input and zero target', () => {
    const stats = consistencyStats([], 4, today, 0);
    assert.equal(stats.avgPerWeek, 0);
    assert.equal(stats.adherencePct, 0);
    assert.equal(stats.perWeek.length, 4);
  });
  it('counts two sessions on the same day as two', () => {
    const stats = consistencyStats(['2026-06-30', '2026-06-30'], 1, today, 4);
    assert.equal(stats.perWeek[0]?.sessions, 2);
    assert.equal(stats.dayOfWeekCounts[1], 2); // Tuesday
  });
});

describe('detectPlateau', () => {
  const series = (values: number[]) =>
    values.map((value, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, value }));
  it('needs at least 6 points', () => {
    assert.equal(detectPlateau([]), 'insufficient');
    assert.equal(detectPlateau(series([1, 2, 3, 4, 5])), 'insufficient');
  });
  it('progressing when best of last 3 beats prior 3 by >1%', () => {
    assert.equal(detectPlateau(series([100, 100, 100, 100, 100, 102])), 'progressing');
  });
  it('regressing when best of last 3 drops >1%', () => {
    assert.equal(detectPlateau(series([100, 100, 100, 98, 98, 98])), 'regressing');
  });
  it('plateau within ±1%', () => {
    assert.equal(detectPlateau(series([100, 100, 100, 100.5, 99.5, 100])), 'plateau');
    assert.equal(detectPlateau(series([100, 100, 100, 100, 100, 100])), 'plateau');
  });
  it('compares bests, not averages', () => {
    // Last 3 dips low but its best (105) still beats the prior best (100)
    assert.equal(detectPlateau(series([100, 90, 95, 50, 105, 60])), 'progressing');
  });
  it('sorts by date before windowing', () => {
    const shuffled = [
      { date: '2026-06-06', value: 102 },
      { date: '2026-06-01', value: 100 },
      { date: '2026-06-04', value: 100 },
      { date: '2026-06-02', value: 100 },
      { date: '2026-06-05', value: 100 },
      { date: '2026-06-03', value: 100 },
    ];
    assert.equal(detectPlateau(shuffled), 'progressing');
  });
  it('uses only the last 6 points of a longer series', () => {
    assert.equal(detectPlateau(series([500, 500, 100, 100, 100, 100, 100, 100])), 'plateau');
  });
});

const day = (kcal: number, protein: number): DailyMacros => ({ kcal, protein, carbs: 0, fat: 0 });

describe('kcalAdherence', () => {
  it('averages logged days and counts ±10% hits', () => {
    const out = kcalAdherence(
      {
        '2026-07-01': day(2000, 150), // in target
        '2026-07-02': day(2150, 150), // in target (within +10% of 2000)
        '2026-07-03': day(2500, 150), // over
      },
      2000,
    );
    assert.deepEqual(out, { daysLogged: 3, avgKcal: 2217, inTargetDays: 2, adherencePct: 67 });
  });
  it('ignores zero-kcal (unlogged) days', () => {
    const out = kcalAdherence({ '2026-07-01': day(0, 0), '2026-07-02': day(1900, 100) }, 2000);
    assert.equal(out.daysLogged, 1);
    assert.equal(out.avgKcal, 1900);
    assert.equal(out.adherencePct, 100);
  });
  it('handles no data and bad targets', () => {
    assert.deepEqual(kcalAdherence({}, 2000), {
      daysLogged: 0,
      avgKcal: 0,
      inTargetDays: 0,
      adherencePct: 0,
    });
    assert.equal(kcalAdherence({ '2026-07-01': day(2000, 0) }, 0).adherencePct, 0);
  });
  it('treats the ±10% band as inclusive', () => {
    assert.equal(kcalAdherence({ a: day(1800, 0) }, 2000).inTargetDays, 1);
    assert.equal(kcalAdherence({ a: day(2200, 0) }, 2000).inTargetDays, 1);
    assert.equal(kcalAdherence({ a: day(2201, 0) }, 2000).inTargetDays, 0);
  });
});

describe('proteinHitRate', () => {
  it('counts days at ≥90% of target', () => {
    const out = proteinHitRate(
      {
        '2026-07-01': day(2000, 160), // hit
        '2026-07-02': day(2000, 144), // hit — exactly 90% of 160
        '2026-07-03': day(2000, 100), // miss
      },
      160,
    );
    assert.deepEqual(out, { daysLogged: 3, hitDays: 2, hitPct: 67 });
  });
  it('ignores unlogged days and handles empty input', () => {
    assert.deepEqual(proteinHitRate({ '2026-07-01': day(0, 0) }, 160), {
      daysLogged: 0,
      hitDays: 0,
      hitPct: 0,
    });
    assert.deepEqual(proteinHitRate({}, 160), { daysLogged: 0, hitDays: 0, hitPct: 0 });
  });
});
