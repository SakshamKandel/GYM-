import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { greeceReply, type CheckInFacts, type CheckInSignals } from './greeceReply.ts';

/** An "everything is fine" week: ok taps, on-track, no PR, no nudge. */
const okSignals: CheckInSignals = { energy: 2, soreness: 2, weekFeel: 2 };

const baseFacts: CheckInFacts = {
  goal: 'muscle',
  tier: 'gold',
  weeklyVolumeKg: 6000,
  prCount: 0,
  trendRatePerWeekKg: 0.2,
  kcalDeltaFromCheckIn: 0,
  deloadSuggested: false,
};

describe('greeceReply — PR presence', () => {
  it('names the top PR lift when one is present', () => {
    const r = greeceReply(okSignals, {
      ...baseFacts,
      prCount: 1,
      topPr: { exerciseName: 'Back Squat', weightKg: 140, reps: 3 },
    });
    assert.ok(r.lines.some((l) => l.includes('Back Squat')));
    assert.ok(r.lines.some((l) => l.includes('GM method')));
  });
  it('falls back to a PR count when there is no single standout', () => {
    const r = greeceReply(okSignals, { ...baseFacts, prCount: 2 });
    assert.ok(r.lines.some((l) => l.includes('2 PRs')));
  });
  it('mentions no PR line when the week had none', () => {
    const r = greeceReply(okSignals, { ...baseFacts, prCount: 0, weeklyVolumeKg: 3000 });
    assert.ok(!r.lines.some((l) => l.includes('PR')));
  });
  it('credits big volume as the win when there is no PR', () => {
    const r = greeceReply(okSignals, { ...baseFacts, prCount: 0, weeklyVolumeKg: 12000 });
    assert.ok(r.lines.some((l) => l.includes('volume')));
  });
});

describe('greeceReply — deload trigger', () => {
  it('adds a deload line when the engine flags it', () => {
    const r = greeceReply(
      { energy: 2, soreness: 3, weekFeel: 2 },
      { ...baseFacts, deloadSuggested: true },
    );
    assert.ok(r.lines.some((l) => l.toLowerCase().includes('lighter week')));
  });
  it('suggests backing off on high soreness + high volume even without the flag', () => {
    const r = greeceReply(
      { energy: 2, soreness: 3, weekFeel: 2 },
      { ...baseFacts, deloadSuggested: false, weeklyVolumeKg: 15000 },
    );
    assert.ok(r.lines.some((l) => l.toLowerCase().includes('lighter week')));
  });
  it('does not force a deload line on a fresh, low-volume week', () => {
    const r = greeceReply(okSignals, { ...baseFacts, weeklyVolumeKg: 4000 });
    assert.ok(!r.lines.some((l) => l.toLowerCase().includes('lighter week')));
  });
});

describe('greeceReply — tier length differences', () => {
  const richFacts: CheckInFacts = {
    ...baseFacts,
    prCount: 1,
    topPr: { exerciseName: 'Bench Press', weightKg: 100, reps: 5 },
    kcalDeltaFromCheckIn: 150,
    trendRatePerWeekKg: 0.3,
  };
  it('silver gets exactly one body line', () => {
    const r = greeceReply(okSignals, { ...richFacts, tier: 'silver' });
    assert.equal(r.lines.length, 1);
    assert.equal(r.signoff, '— The GM Method');
  });
  it('gold gets up to three body lines', () => {
    const r = greeceReply(okSignals, { ...richFacts, tier: 'gold' });
    assert.ok(r.lines.length > 1);
    assert.ok(r.lines.length <= 3);
    assert.equal(r.signoff, '— The GM Method');
  });
  it('elite signs off from Greece and acknowledges the 1:1 relationship', () => {
    const r = greeceReply(okSignals, { ...richFacts, tier: 'elite' });
    assert.equal(r.signoff, '— Greece');
    assert.ok(r.lines.length <= 3);
    assert.ok(r.lines.some((l) => l.toLowerCase().includes('personally')));
  });
});

describe('greeceReply — calorie delta wording', () => {
  it('renders a positive delta with a + sign', () => {
    const r = greeceReply(okSignals, { ...baseFacts, kcalDeltaFromCheckIn: 150 });
    assert.ok(r.lines.some((l) => l.includes('+150')));
  });
  it('renders a negative delta with a minus sign', () => {
    const r = greeceReply(okSignals, { ...baseFacts, kcalDeltaFromCheckIn: -75 });
    assert.ok(r.lines.some((l) => l.includes('-75')));
  });
  it('says calories held when the delta is zero', () => {
    const r = greeceReply(okSignals, { ...baseFacts, kcalDeltaFromCheckIn: 0 });
    assert.ok(r.lines.some((l) => l.toLowerCase().includes('stay put')));
  });
});

describe('greeceReply — signal variation', () => {
  it('an all-good, strong week reads upbeat', () => {
    const r = greeceReply(
      { energy: 3, soreness: 1, weekFeel: 3 },
      { ...baseFacts, prCount: 1, topPr: { exerciseName: 'Deadlift', weightKg: 180, reps: 2 } },
    );
    assert.match(r.headline, /Strong week/);
    assert.ok(r.lines.length >= 1);
  });
  it('a low-energy tough week emphasises recovery', () => {
    const r = greeceReply(
      { energy: 1, soreness: 2, weekFeel: 1 },
      { ...baseFacts, tier: 'gold' },
    );
    assert.match(r.headline, /reset|tough|Rough/i);
    assert.ok(r.lines.some((l) => l.toLowerCase().includes('sleep')));
  });
  it('always returns a headline, at least one line, and a signoff', () => {
    const tiers: CheckInFacts['tier'][] = ['silver', 'gold', 'elite'];
    const goals: CheckInFacts['goal'][] = ['fat_loss', 'muscle', 'strength'];
    for (const tier of tiers) {
      for (const goal of goals) {
        const r = greeceReply(okSignals, { ...baseFacts, tier, goal });
        assert.ok(r.headline.length > 0);
        assert.ok(r.lines.length >= 1);
        assert.ok(r.signoff.length > 0);
      }
    }
  });
});
