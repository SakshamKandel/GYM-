import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BADGE_CATALOG,
  STRENGTH_BADGE_IDS,
  badgeProgress,
  badgeTier,
  canonicalLift,
  computeEarnedBadgeIds,
  type BadgeComputeInput,
  type BadgeProgressStats,
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
  it('has exactly 42 badges', () => {
    assert.equal(BADGE_CATALOG.length, 42);
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
    assert.equal(counts.crew, 4);
  });

  it('STRENGTH_BADGE_IDS matches the strength family exactly', () => {
    const fromCatalog = BADGE_CATALOG.filter((b) => b.family === 'strength').map((b) => b.id).sort();
    assert.deepEqual([...STRENGTH_BADGE_IDS].sort(), fromCatalog);
  });

  it('every badge has a non-empty description', () => {
    for (const b of BADGE_CATALOG) {
      assert.ok(b.description.length > 10, `${b.id} needs a real description`);
    }
  });
});

function emptyStats(overrides: Partial<BadgeProgressStats> = {}): BadgeProgressStats {
  return {
    bestE1RmByLift: {},
    lifetimeSessionDays: 0,
    lifetimeTonnageKg: 0,
    prCount: 0,
    streakWeeksBest: 0,
    checkInCount: 0,
    hasBuddy: false,
    ...overrides,
  };
}

describe('badgeProgress', () => {
  const byId = new Map(BADGE_CATALOG.map((b) => [b.id, b]));

  it('tracks a single-lift strength club against best e1RM', () => {
    const p = badgeProgress(byId.get('bench_100')!, emptyStats({ bestE1RmByLift: { bench: 82.5 } }));
    assert.deepEqual(p, { current: 82.5, target: 100, unit: 'kg' });
  });

  it('total club shows the partial big-three sum even with lifts missing', () => {
    const p = badgeProgress(
      byId.get('total_300')!,
      emptyStats({ bestE1RmByLift: { bench: 80, squat: 110 } }),
    );
    assert.deepEqual(p, { current: 190, target: 300, unit: 'kg' });
  });

  it('sessions and streak badges use their respective counters', () => {
    const stats = emptyStats({ lifetimeSessionDays: 18, streakWeeksBest: 5 });
    assert.deepEqual(badgeProgress(byId.get('sessions_25')!, stats), {
      current: 18,
      target: 25,
      unit: 'sessions',
    });
    assert.deepEqual(badgeProgress(byId.get('streak_8w')!, stats), {
      current: 5,
      target: 8,
      unit: 'weeks',
    });
  });

  it('mileage, records and check-in badges report kg / prs / check-ins', () => {
    const stats = emptyStats({ lifetimeTonnageKg: 42_000, prCount: 7, checkInCount: 3 });
    assert.deepEqual(badgeProgress(byId.get('tonnage_50k')!, stats), {
      current: 42_000,
      target: 50_000,
      unit: 'kg',
    });
    assert.deepEqual(badgeProgress(byId.get('pr_25')!, stats), { current: 7, target: 25, unit: 'prs' });
    assert.deepEqual(badgeProgress(byId.get('checkin_10')!, stats), {
      current: 3,
      target: 10,
      unit: 'check-ins',
    });
  });

  it('the retired buddy badges are gone from the catalog', () => {
    assert.equal(byId.get('buddy_first'), undefined);
    assert.equal(byId.get('buddy_quest'), undefined);
  });

  it('event-shaped badges have no scalar progress', () => {
    assert.equal(badgeProgress(byId.get('comeback')!, emptyStats()), null);
    assert.equal(badgeProgress(byId.get('coach_pick')!, emptyStats()), null);
  });

  it('progress reaching target agrees with computeEarnedBadgeIds for threshold badges', () => {
    // A stats snapshot exactly at several thresholds must award exactly those
    // badges AND report current >= target through badgeProgress — the two
    // evaluators may never disagree (they drive "earned" vs "progress" UI).
    const stats = emptyStats({
      bestE1RmByLift: { bench: 100, squat: 100, deadlift: 100 },
      lifetimeSessionDays: 25,
      streakWeeksBest: 8,
      prCount: 25,
      checkInCount: 10,
      lifetimeTonnageKg: 50_000,
      hasBuddy: true,
    });
    const earned = new Set(
      computeEarnedBadgeIds({ ...stats, sessionDayIsos: ['2026-07-01'] }),
    );
    for (const badge of BADGE_CATALOG) {
      const p = badgeProgress(badge, stats);
      if (p === null || badge.lift === 'total') continue; // total's partial-sum display is the documented exception
      const done = p.current >= p.target;
      assert.equal(
        done,
        earned.has(badge.id),
        `${badge.id}: progress says ${done ? 'done' : 'not done'} but award engine disagrees`,
      );
    }
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

  it('never awards retired or event-driven crew badges from the pure pass', () => {
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
    assert.ok(!maxedOut.includes('buddy_first'));
    assert.ok(!maxedOut.includes('buddy_quest'));
    assert.ok(!maxedOut.includes('coach_pick'));
  });

  it('a fully maxed input earns every non-event-driven badge (41 of 42)', () => {
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
    assert.equal(maxedOut.length, 41); // 42 minus coach_pick
  });
});

describe('badgeTier', () => {
  const byId = new Map(BADGE_CATALOG.map((b) => [b.id, b]));
  const tierOf = (id: string) => badgeTier(byId.get(id)!);

  it('3-rung ladders run bronze → silver → gold', () => {
    assert.deepEqual(
      ['bench_60', 'bench_100', 'bench_140'].map(tierOf),
      ['bronze', 'silver', 'gold'],
    );
    assert.deepEqual(['ohp_40', 'ohp_60', 'ohp_80'].map(tierOf), ['bronze', 'silver', 'gold']);
    assert.deepEqual(
      ['total_300', 'total_450', 'total_600'].map(tierOf),
      ['bronze', 'silver', 'gold'],
    );
  });

  it('4-rung ladders (squat, deadlift) top out at elite', () => {
    assert.deepEqual(
      ['squat_60', 'squat_100', 'squat_140', 'squat_180'].map(tierOf),
      ['bronze', 'silver', 'gold', 'elite'],
    );
    assert.deepEqual(
      ['deadlift_100', 'deadlift_140', 'deadlift_180', 'deadlift_220'].map(tierOf),
      ['bronze', 'silver', 'gold', 'elite'],
    );
  });

  it('every strength badge has a tier; every other badge has none', () => {
    for (const badge of BADGE_CATALOG) {
      const tier = badgeTier(badge);
      if (badge.family === 'strength') assert.notEqual(tier, null, badge.id);
      else assert.equal(tier, null, badge.id);
    }
  });

  it('a badge not in the catalog (challenge extra) gets no tier', () => {
    assert.equal(
      badgeTier({
        id: 'challenge:abc',
        family: 'crew',
        name: 'Challenge',
        description: '',
        icon: 'award',
        sort: 900,
      }),
      null,
    );
  });
});
