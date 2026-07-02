import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectGoal } from './projection.ts';

describe('projectGoal', () => {
  it('projects weeks for an on-track loss', () => {
    const p = projectGoal({ trendKg: 80, targetKg: 76, ratePerWeekKg: -0.5 });
    assert.equal(p.status, 'onTrack');
    assert.equal(p.etaWeeks, 8);
  });
  it('flags unsafe pace but still gives the ETA', () => {
    const p = projectGoal({ trendKg: 80, targetKg: 70, ratePerWeekKg: -1.2 }); // 1.5% BW/wk
    assert.equal(p.status, 'tooFast');
    assert.equal(p.etaWeeks, 9);
  });
  it('detects the trend moving away from the target', () => {
    const p = projectGoal({ trendKg: 80, targetKg: 75, ratePerWeekKg: 0.4 });
    assert.equal(p.status, 'wrongDirection');
  });
  it('handles a flat trend', () => {
    assert.equal(projectGoal({ trendKg: 80, targetKg: 75, ratePerWeekKg: 0.01 }).status, 'noTrend');
  });
  it('recognizes a reached target', () => {
    assert.equal(projectGoal({ trendKg: 75.3, targetKg: 75, ratePerWeekKg: -0.2 }).status, 'reached');
  });
  it('caps absurd timelines', () => {
    assert.equal(projectGoal({ trendKg: 120, targetKg: 70, ratePerWeekKg: -0.06 }).status, 'farOut');
  });
  it('gain goals use the tighter safe band', () => {
    const safe = projectGoal({ trendKg: 60, targetKg: 64, ratePerWeekKg: 0.25 });
    assert.equal(safe.status, 'onTrack');
    const fast = projectGoal({ trendKg: 60, targetKg: 64, ratePerWeekKg: 0.5 });
    assert.equal(fast.status, 'tooFast');
  });
});
