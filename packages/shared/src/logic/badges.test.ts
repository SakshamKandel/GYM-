import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BADGE_CATALOG,
  STRENGTH_BADGE_IDS,
  canonicalLift,
  computeEarnedBadgeIds,
  type BadgeComputeInput,
} from './badges.ts';

function emptyInput(overrides: Partial<BadgeComputeInput> = {}): BadgeComputeInput {
  return {
    bestE1RmByLift: {},
    lifetimeSessionDays: 0,
    lifetimeTonnageKg: 0,
    prCount: 0,
    streakWeeksBest: 0,
    sessionDayIsos: [],
    checkInCount: 0,
    hasBuddy: false,
    ...overrides,
  };
}

describe('BADGE_CATALOG', () => {
  it('has exactly 44 badges at launch', () => {
    assert.equal(BADGE_CATALOG.length, 44);
  });

  it('every badge id is unique', () => {
    const ids = new Set(BADGE_CATALOG.map((b) => b.id));
    assert.equal(ids.size, BADGE_CATALOG.length);
  });

  it('family counts match the spec exactly', () => {
    const counts: Record<string, number> = {};
    for (const b of BADGE_CATALOG) counts[b.family] = (counts[b.family] ?? 0) + 1;
    assert.equal(counts.strength, 17);
    assert.equal(counts.consistency, 13);
    assert.equal(counts.mileage, 5);
    assert.equal(counts.records, 3);
    assert.equal(counts.crew, 6);
  });

  it('STRENGTH_BADGE_IDS matches the strength family exactly', () => {
    const fromCatalog = BADGE_CATALOG.filter((b) => b.family === 'strength').map((b) => b.id).sort();
    assert.deepEqual([...STRENGTH_BADGE_IDS].sort(), fromCatalog);
  });
});

describe('canonicalLift', () => {
  it('matches bench press variants', () => {
    assert.equal(canonicalLift('x', 'Barbell Bench Press'), 'bench');
    assert.equal(canonicalLift('x', 'Incline Bench Press'), 'bench');
  });

  it('matches squat variants', () => {
    assert.equal(canonicalLift('x', 'Barbell Squat'), 'squat');
    assert.equal(canonicalLift('x', 'Front Squat'), 'squat');
  });

  it('matches deadlift but excludes romanian/stiff-leg variants', () => {
    assert.equal(canonicalLift('x', 'Deadlift'), 'deadlift');
    assert.equal(canonicalLift('x', 'Sumo Deadlift'), 'deadlift');
    assert.equal(canonicalLift('x', 'Romanian Deadlift'), null);
    assert.equal(canonicalLift('x', 'Stiff-Leg Deadlift'), null);
  });

  it('matches overhead/military press', () => {
    assert.equal(canonicalLift('x', 'Overhead Press'), 'ohp');
    assert.equal(canonicalLift('x', 'Military Press'), 'ohp');
  });

  it('returns null for unrelated exercises', () => {
    assert.equal(canonicalLift('x', 'Bicep Curl'), null);
    assert.equal(canonicalLift('x', 'Leg Press'), null);
  });
});

describe('computeEarnedBadgeIds — strength clubs', () => {
  it('awards a strength badge exactly at threshold, not below', () => {
    const at = computeEarnedBadgeIds(emptyInput({ bestE1RmByLift: { bench: 60 } }));
    assert.ok(at.includes('bench_60'));
    const below = computeEarnedBadgeIds(emptyInput({ bestE1RmByLift: { bench: 59.9 } }));
    assert.ok(!below.includes('bench_60'));
  });

  it('awards all lower thresholds when a high e1RM is hit', () => {
    const earned = computeEarnedBadgeIds(emptyInput({ bestE1RmByLift: { squat: 185 } }));
    assert.ok(earned.includes('squat_60'));
    assert.ok(earned.includes('squat_100'));
    assert.ok(earned.includes('squat_140'));
    assert.ok(earned.includes('squat_180'));
  });

  it('total badges require all three of bench/squat/deadlift to be present', () => {
    const partial = computeEarnedBadgeIds(emptyInput({ bestE1RmByLift: { bench: 150, squat: 200 } }));
    assert.ok(!partial.includes('total_300'));
    const full = computeEarnedBadgeIds(
      emptyInput({ bestE1RmByLift: { bench: 100, squat: 150, deadlift: 200 } }),
    );
    assert.ok(full.includes('total_300')); // 450 total
    assert.ok(full.includes('total_450'));
    assert.ok(!full.includes('total_600'));
  });

  it('ohp thresholds evaluate independently of other lifts', () => {
    const earned = computeEarnedBadgeIds(emptyInput({ bestE1RmByLift: { ohp: 65 } }));
    assert.ok(earned.includes('ohp_40'));
    assert.ok(earned.includes('ohp_60'));
    assert.ok(!earned.includes('ohp_80'));
  });
});

describe('computeEarnedBadgeIds — consistency', () => {
  it('day_one requires at least one session-day', () => {
    assert.ok(!computeEarnedBadgeIds(emptyInput()).includes('day_one'));
    assert.ok(computeEarnedBadgeIds(emptyInput({ sessionDayIsos: ['2026-07-01'] })).includes('day_one'));
  });

  it('session-count thresholds use lifetimeSessionDays', () => {
    const earned = computeEarnedBadgeIds(emptyInput({ lifetimeSessionDays: 50 }));
    assert.ok(earned.includes('sessions_10'));
    assert.ok(earned.includes('sessions_25'));
    assert.ok(earned.includes('sessions_50'));
    assert.ok(!earned.includes('sessions_100'));
  });

  it('streak-week badges use streakWeeksBest', () => {
    const earned = computeEarnedBadgeIds(emptyInput({ streakWeeksBest: 12 }));
    assert.ok(earned.includes('streak_4w'));
    assert.ok(earned.includes('streak_8w'));
    assert.ok(earned.includes('streak_12w'));
    assert.ok(!earned.includes('streak_26w'));
  });

  it('comeback fires when the two most recent session-days have a >=14-day gap', () => {
    const earned = computeEarnedBadgeIds(
      emptyInput({ sessionDayIsos: ['2026-06-01', '2026-06-20'] }), // 19-day gap
    );
    assert.ok(earned.includes('comeback'));
  });

  it('comeback does not fire for a normal gap', () => {
    const earned = computeEarnedBadgeIds(
      emptyInput({ sessionDayIsos: ['2026-06-01', '2026-06-05'] }), // 4-day gap
    );
    assert.ok(!earned.includes('comeback'));
  });

  it('comeback needs at least two session-days', () => {
    const earned = computeEarnedBadgeIds(emptyInput({ sessionDayIsos: ['2026-06-01'] }));
    assert.ok(!earned.includes('comeback'));
  });

  it('comeback is exact at the 14-day boundary', () => {
    const earned = computeEarnedBadgeIds(
      emptyInput({ sessionDayIsos: ['2026-06-01', '2026-06-15'] }), // exactly 14 days
    );
    assert.ok(earned.includes('comeback'));
    const oneShort = computeEarnedBadgeIds(
      emptyInput({ sessionDayIsos: ['2026-06-01', '2026-06-14'] }), // 13 days
    );
    assert.ok(!oneShort.includes('comeback'));
  });
});

describe('computeEarnedBadgeIds — mileage, records, crew', () => {
  it('mileage thresholds use lifetimeTonnageKg', () => {
    const earned = computeEarnedBadgeIds(emptyInput({ lifetimeTonnageKg: 75_000 }));
    assert.ok(earned.includes('tonnage_10k'));
    assert.ok(earned.includes('tonnage_50k'));
    assert.ok(!earned.includes('tonnage_100k'));
  });

  it('records thresholds use prCount', () => {
    const earned = computeEarnedBadgeIds(emptyInput({ prCount: 30 }));
    assert.ok(earned.includes('pr_first'));
    assert.ok(earned.includes('pr_25'));
    assert.ok(!earned.includes('pr_100'));
  });

  it('checkin thresholds use checkInCount', () => {
    const earned = computeEarnedBadgeIds(emptyInput({ checkInCount: 15 }));
    assert.ok(earned.includes('checkin_first'));
    assert.ok(earned.includes('checkin_10'));
    assert.ok(!earned.includes('checkin_25'));
  });

  it('buddy_first fires only when hasBuddy is true', () => {
    assert.ok(!computeEarnedBadgeIds(emptyInput({ hasBuddy: false })).includes('buddy_first'));
    assert.ok(computeEarnedBadgeIds(emptyInput({ hasBuddy: true })).includes('buddy_first'));
  });

  it('never awards event-driven crew badges from the pure pass', () => {
    const maxedOut = computeEarnedBadgeIds(
      emptyInput({
        hasBuddy: true,
        checkInCount: 999,
        lifetimeSessionDays: 999,
        lifetimeTonnageKg: 10_000_000,
        prCount: 999,
        streakWeeksBest: 999,
        bestE1RmByLift: { bench: 999, squat: 999, deadlift: 999, ohp: 999 },
        sessionDayIsos: ['2026-01-01', '2026-07-01'],
      }),
    );
    assert.ok(!maxedOut.includes('buddy_quest'));
    assert.ok(!maxedOut.includes('coach_pick'));
  });

  it('a fully maxed input earns every non-event-driven badge (42 of 44)', () => {
    const maxedOut = computeEarnedBadgeIds(
      emptyInput({
        hasBuddy: true,
        checkInCount: 999,
        lifetimeSessionDays: 999,
        lifetimeTonnageKg: 10_000_000,
        prCount: 999,
        streakWeeksBest: 999,
        bestE1RmByLift: { bench: 999, squat: 999, deadlift: 999, ohp: 999 },
        sessionDayIsos: ['2026-01-01', '2026-07-01'],
      }),
    );
    assert.equal(maxedOut.length, 42); // 44 minus buddy_quest and coach_pick
  });
});
