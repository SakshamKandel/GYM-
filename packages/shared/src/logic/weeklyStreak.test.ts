import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';

// weeklyStreak.ts imports its sibling helper (./analytics) without an extension —
// the repo-wide source idiom (see progression.test.ts for the full rationale).
// Bridge relative specifiers to their .ts files for this test process only.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (typeof specifier === 'string' && specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const { computeWeeklyStreak, restShieldQuota, planShieldUse } = await import('./weeklyStreak.ts');

// 2026-07-06 is a Monday. Weeks below are anchored to that for clarity.
// Week A: 2026-06-22 (Mon) .. 2026-06-28 (Sun)
// Week B: 2026-06-29 (Mon) .. 2026-07-05 (Sun)
// Week C (current in most tests): 2026-07-06 (Mon) .. 2026-07-12 (Sun)

describe('computeWeeklyStreak', () => {
  it('counts a week when distinct session-days >= target', () => {
    const days = ['2026-06-29', '2026-06-30', '2026-07-01']; // week B, 3 distinct days
    const state = computeWeeklyStreak(days, 3, '2026-07-06', []);
    assert.equal(state.weeks, 1);
    assert.equal(state.weekStart, '2026-07-06');
    assert.equal(state.thisWeekDays, 0);
  });

  it('does not count a week short of target', () => {
    const days = ['2026-06-29', '2026-06-30']; // only 2 of 3 needed
    const state = computeWeeklyStreak(days, 3, '2026-07-06', []);
    assert.equal(state.weeks, 0);
  });

  it('duplicate same-day workouts do not inflate the distinct-day count', () => {
    const days = ['2026-06-29', '2026-06-29', '2026-06-29', '2026-06-30', '2026-07-01'];
    const state = computeWeeklyStreak(days, 3, '2026-07-06', []);
    assert.equal(state.weeks, 1); // 3 distinct days despite 5 entries
  });

  it('the current in-progress week never breaks the streak while short', () => {
    const days = [
      '2026-06-29', '2026-06-30', '2026-07-01', // week B complete (3/3)
      '2026-07-06', // week C: only 1 day so far, today
    ];
    const state = computeWeeklyStreak(days, 3, '2026-07-07', []); // Tuesday of week C
    assert.equal(state.thisWeekDays, 1);
    assert.equal(state.weeks, 1); // week B counts; week C incomplete but doesn't break it
  });

  it('current week is included once it already meets target mid-week', () => {
    const days = [
      '2026-06-29', '2026-06-30', '2026-07-01', // week B complete
      '2026-07-06', '2026-07-07', '2026-07-08', // week C already hits 3/3
    ];
    const state = computeWeeklyStreak(days, 3, '2026-07-08', []);
    assert.equal(state.thisWeekDays, 3);
    assert.equal(state.weeks, 2); // both weeks counted
  });

  it('a fully missed past week breaks the consecutive streak', () => {
    const days = [
      '2026-06-15', '2026-06-16', '2026-06-17', // two weeks back, complete
      // week starting 2026-06-22 missed entirely
      '2026-06-29', '2026-06-30', '2026-07-01', // week B complete
    ];
    const state = computeWeeklyStreak(days, 3, '2026-07-06', []);
    assert.equal(state.weeks, 1); // only week B counts; the gap breaks the chain
  });

  it('consecutive complete weeks accumulate', () => {
    const days = [
      '2026-06-15', '2026-06-16', '2026-06-17',
      '2026-06-22', '2026-06-23', '2026-06-24',
      '2026-06-29', '2026-06-30', '2026-07-01',
    ];
    const state = computeWeeklyStreak(days, 3, '2026-07-06', []);
    assert.equal(state.weeks, 3);
  });

  it('a shielded week counts even with zero session-days', () => {
    // week starting 2026-06-29 (immediately before the current week) has zero
    // days but is shielded, so it counts instead of breaking the chain.
    const shielded = ['2026-06-29'];
    const state = computeWeeklyStreak([], 3, '2026-07-06', shielded);
    assert.equal(state.weeks, 1);
  });

  it('shield plus real weeks chain together', () => {
    const days = [
      '2026-06-15', '2026-06-16', '2026-06-17', // complete
      // 2026-06-22 week shielded (no real days)
      '2026-06-29', '2026-06-30', '2026-07-01', // complete
    ];
    const shielded = ['2026-06-22'];
    const state = computeWeeklyStreak(days, 3, '2026-07-06', shielded);
    assert.equal(state.weeks, 3); // 06-15 week, shielded 06-22 week, 06-29 week
  });

  it('respects a custom weekly target other than 3', () => {
    const days = ['2026-06-29', '2026-06-30']; // 2 days, target 2
    const state = computeWeeklyStreak(days, 2, '2026-07-06', []);
    assert.equal(state.weeks, 1);
  });

  it('empty history yields a zero streak with zero days this week', () => {
    const state = computeWeeklyStreak([], 3, '2026-07-06', []);
    assert.equal(state.weeks, 0);
    assert.equal(state.thisWeekDays, 0);
    assert.equal(state.weekStart, '2026-07-06');
  });

  it('week boundary: a Sunday session belongs to the week that started the prior Monday', () => {
    // 2026-07-05 is the Sunday of week B (2026-06-29..2026-07-05)
    const days = ['2026-06-29', '2026-06-30', '2026-07-05'];
    const state = computeWeeklyStreak(days, 3, '2026-07-06', []);
    assert.equal(state.weeks, 1); // all 3 land in week B, not split across the boundary
  });
});

describe('restShieldQuota', () => {
  it('starter and silver get no shields', () => {
    assert.equal(restShieldQuota('starter'), 0);
    assert.equal(restShieldQuota('silver'), 0);
  });
  it('gold gets 1 per month, elite gets 2', () => {
    assert.equal(restShieldQuota('gold'), 1);
    assert.equal(restShieldQuota('elite'), 2);
  });
});

describe('planShieldUse', () => {
  it('does not shield a missed week with no streak behind it (nothing to protect)', () => {
    // No session history at all — the missed week B (06-29) has zero
    // consecutive met/shielded weeks behind it, so shielding it would waste
    // the month's quota protecting a streak that never existed.
    const plans = planShieldUse({
      sessionDayIsos: [],
      weeklyTarget: 3,
      todayIso: '2026-07-06',
      existingUses: [],
      quotaPerMonth: 1,
    });
    assert.equal(plans.length, 0);
  });

  it('plans a shield for a missed week that has a met week behind it', () => {
    // Week A (06-22) meets target on its own; week B (06-29) is missed but
    // has a real streak (week A) behind it, so it's worth protecting. Week C
    // (07-06) is the current, still-in-progress week and is excluded from
    // the walk entirely.
    const days = ['2026-06-22', '2026-06-23', '2026-06-24'];
    const plans = planShieldUse({
      sessionDayIsos: days,
      weeklyTarget: 3,
      todayIso: '2026-07-06',
      existingUses: [],
      quotaPerMonth: 1,
    });
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.weekStart, '2026-06-29');
    assert.equal(plans[0]?.monthKey, '2026-06');
  });

  it('stops planning once the monthly quota is exhausted', () => {
    // Three consecutive met weeks, then two missed weeks in the same month,
    // quota is 1 — only the most recent missed week gets a shield.
    const days = ['2026-06-08', '2026-06-09', '2026-06-10'];
    const plans = planShieldUse({
      sessionDayIsos: days,
      weeklyTarget: 3,
      todayIso: '2026-07-06',
      existingUses: [],
      quotaPerMonth: 1,
    });
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.weekStart, '2026-06-29');
  });

  it('does not re-plan a week that already has a recorded shield use', () => {
    const days = ['2026-06-08', '2026-06-09', '2026-06-10'];
    const plans = planShieldUse({
      sessionDayIsos: days,
      weeklyTarget: 3,
      todayIso: '2026-07-06',
      existingUses: [{ weekStart: '2026-06-29', monthKey: '2026-06' }],
      quotaPerMonth: 1,
    });
    // 06-29 already used (chain continues past it for free), but June quota
    // (1) is now spent, so 06-22 cannot be newly planned.
    assert.equal(plans.length, 0);
  });

  it('a week that meets target on its own needs no shield and does not consume quota', () => {
    // week B (2026-06-29) meets target on its own — no shield spent there —
    // but the walk continues past it and still finds+plans the next gap,
    // which has week B's met streak behind it.
    const days = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-29', '2026-06-30', '2026-07-01'];
    const plans = planShieldUse({
      sessionDayIsos: days,
      weeklyTarget: 3,
      todayIso: '2026-07-06',
      existingUses: [],
      quotaPerMonth: 1,
    });
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.weekStart, '2026-06-22'); // week B itself never consumes a shield
  });

  it('zero quota plans nothing', () => {
    const days = ['2026-06-22', '2026-06-23', '2026-06-24'];
    const plans = planShieldUse({
      sessionDayIsos: days,
      weeklyTarget: 3,
      todayIso: '2026-07-13',
      existingUses: [],
      quotaPerMonth: 0,
    });
    assert.equal(plans.length, 0);
  });

  it('a missed week spanning a month boundary uses the month containing its Monday', () => {
    // week starting 2026-06-29 (Monday) belongs to June even though it runs into July.
    // Week A (06-22) meets target so week B has a streak behind it worth shielding.
    const days = ['2026-06-22', '2026-06-23', '2026-06-24'];
    const plans = planShieldUse({
      sessionDayIsos: days,
      weeklyTarget: 3,
      todayIso: '2026-07-13',
      existingUses: [],
      quotaPerMonth: 5,
    });
    const juneWeek = plans.find((p) => p.weekStart === '2026-06-29');
    assert.equal(juneWeek?.monthKey, '2026-06');
  });

  it('does not shield a week that is not yet safely elapsed (recent UTC rollover)', () => {
    // Week B (06-29..07-05) only becomes judgeable once today >= 07-06
    // (weekStart + 7). One day earlier (07-05, still technically "next
    // week" by naive UTC-date math for a user behind UTC) must not shield it.
    const days = ['2026-06-22', '2026-06-23', '2026-06-24'];
    const plans = planShieldUse({
      sessionDayIsos: days,
      weeklyTarget: 3,
      todayIso: '2026-07-05',
      existingUses: [],
      quotaPerMonth: 1,
    });
    assert.equal(plans.length, 0);
  });
});
