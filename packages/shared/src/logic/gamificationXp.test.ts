import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  XP_AWARDS,
  PR_XP_WEEKLY_CAP,
  xpForLevel,
  levelForXp,
  levelProgress,
  computeRank,
} from './gamificationXp.ts';

describe('XP_AWARDS', () => {
  it('is bounded per event kind — never scaled by volume (design law 1)', () => {
    assert.equal(XP_AWARDS.daily_workout, 50);
    assert.equal(XP_AWARDS.streak_week, 100);
    assert.equal(XP_AWARDS.checkin, 30);
    assert.equal(XP_AWARDS.pr, 20);
    assert.equal(XP_AWARDS.badge, 50);
  });

  it('caps PR credit at 5 per week', () => {
    assert.equal(PR_XP_WEEKLY_CAP, 5);
  });
});

describe('xpForLevel / levelForXp', () => {
  it('level 1 starts at 0 xp', () => {
    assert.equal(xpForLevel(1), 0);
    assert.equal(levelForXp(0), 1);
  });

  it('matches the 100 * (level-1)^2 curve', () => {
    assert.equal(xpForLevel(2), 100);
    assert.equal(xpForLevel(3), 400);
    assert.equal(xpForLevel(4), 900);
    assert.equal(xpForLevel(11), 10_000);
  });

  it('is strictly monotonic increasing across levels 1..200', () => {
    let prev = xpForLevel(1);
    for (let lvl = 2; lvl <= 200; lvl++) {
      const cur = xpForLevel(lvl);
      assert.ok(cur > prev, `xpForLevel(${lvl})=${cur} should exceed xpForLevel(${lvl - 1})=${prev}`);
      prev = cur;
    }
  });

  it('levelForXp is monotonic non-decreasing as xp increases', () => {
    let prevLevel = levelForXp(0);
    for (let xp = 0; xp <= 50_000; xp += 137) {
      const lvl = levelForXp(xp);
      assert.ok(lvl >= prevLevel, `levelForXp(${xp})=${lvl} should not regress below ${prevLevel}`);
      prevLevel = lvl;
    }
  });

  it('levelForXp and xpForLevel round-trip at level boundaries', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const floor = xpForLevel(lvl);
      assert.equal(levelForXp(floor), lvl);
      // one xp short of the next level must still report the current level
      const nextFloor = xpForLevel(lvl + 1);
      assert.equal(levelForXp(nextFloor - 1), lvl);
    }
  });

  it('negative xp is clamped to level 1 / zero progress', () => {
    assert.equal(levelForXp(-500), 1);
  });
});

describe('levelProgress', () => {
  it('reports zero progress at the exact start of a level', () => {
    const p = levelProgress(400); // level 3 starts at 400
    assert.equal(p.level, 3);
    assert.equal(p.xpIntoLevel, 0);
    assert.equal(p.xpForNextLevel, xpForLevel(4) - xpForLevel(3));
  });

  it('reports partial progress mid-level', () => {
    const p = levelProgress(150); // level 2 spans [100, 400)
    assert.equal(p.level, 2);
    assert.equal(p.xpIntoLevel, 50);
    assert.equal(p.xpForNextLevel, 300);
  });

  it('clamps negative xp to level 1 zero progress', () => {
    const p = levelProgress(-10);
    assert.equal(p.level, 1);
    assert.equal(p.xpIntoLevel, 0);
  });
});

describe('computeRank', () => {
  it('elite requires high ratio, lifetime volume, and check-in adherence', () => {
    const target90 = 3 * (90 / 7); // ≈38.57 session-days for a 3/week target over 90 days
    const rank = computeRank({
      sessionDays90: Math.ceil(target90 * 0.95),
      weeklyTargetDays: 3,
      lifetimeSessionDays: 200,
      checkIns90: 12,
    });
    assert.equal(rank, 'elite');
  });

  it('falls back to gold when lifetime volume is insufficient for elite', () => {
    const target90 = 3 * (90 / 7);
    const rank = computeRank({
      sessionDays90: Math.ceil(target90 * 0.95),
      weeklyTargetDays: 3,
      lifetimeSessionDays: 60, // >= gold's 50 but < elite's 150
      checkIns90: 12,
    });
    assert.equal(rank, 'gold');
  });

  it('falls back to silver when check-in adherence is missing for gold', () => {
    const target90 = 3 * (90 / 7);
    const rank = computeRank({
      sessionDays90: Math.ceil(target90 * 0.8),
      weeklyTargetDays: 3,
      lifetimeSessionDays: 60,
      checkIns90: 0, // below gold's 6
    });
    assert.equal(rank, 'silver');
  });

  it('bronze is the floor for low consistency', () => {
    const rank = computeRank({
      sessionDays90: 1,
      weeklyTargetDays: 3,
      lifetimeSessionDays: 3,
      checkIns90: 0,
    });
    assert.equal(rank, 'bronze');
  });

  it('ratio is clamped at 1 — overtraining cannot inflate rank further', () => {
    const rank = computeRank({
      sessionDays90: 10_000, // absurd overtraining
      weeklyTargetDays: 3,
      lifetimeSessionDays: 200,
      checkIns90: 20,
    });
    assert.equal(rank, 'elite'); // still just elite, not some higher tier (none exists)
  });

  it('handles a zero weekly target without dividing by zero', () => {
    const rank = computeRank({
      sessionDays90: 50,
      weeklyTargetDays: 0,
      lifetimeSessionDays: 200,
      checkIns90: 20,
    });
    assert.equal(rank, 'bronze');
  });
});
