import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPr, epley1Rm } from './pr.ts';

describe('epley1Rm', () => {
  it('returns the weight itself for a single', () => {
    assert.equal(epley1Rm(100, 1), 100);
  });
  it('estimates above the weight for reps > 1', () => {
    assert.equal(epley1Rm(100, 5), 116.7);
  });
  it('caps at 12 reps so high-rep sets do not inflate', () => {
    assert.equal(epley1Rm(60, 20), epley1Rm(60, 12));
  });
  it('rejects nonsense input', () => {
    assert.equal(epley1Rm(0, 5), 0);
    assert.equal(epley1Rm(100, 0), 0);
  });
});

describe('checkPr', () => {
  it('first ever set is a "first" PR', () => {
    const r = checkPr({ weightKg: 60, reps: 8, previousBestE1Rm: null, previousBestWeightKg: null });
    assert.equal(r.isPr, true);
    assert.equal(r.kind, 'first');
  });
  it('heavier than ever lifted is a weight PR', () => {
    const r = checkPr({ weightKg: 105, reps: 1, previousBestE1Rm: 110, previousBestWeightKg: 100 });
    assert.equal(r.isPr, true);
    assert.equal(r.kind, 'weight');
  });
  it('better e1RM at same weight is an e1rm PR', () => {
    // 100x5 = 116.7 e1RM beats a previous best of 112
    const r = checkPr({ weightKg: 100, reps: 5, previousBestE1Rm: 112, previousBestWeightKg: 100 });
    assert.equal(r.isPr, true);
    assert.equal(r.kind, 'e1rm');
  });
  it('a worse set is not a PR', () => {
    const r = checkPr({ weightKg: 80, reps: 3, previousBestE1Rm: 120, previousBestWeightKg: 110 });
    assert.equal(r.isPr, false);
    assert.equal(r.kind, null);
  });
  it('high-rep sets never count as e1rm PRs', () => {
    const r = checkPr({ weightKg: 60, reps: 25, previousBestE1Rm: 80, previousBestWeightKg: 100 });
    assert.equal(r.isPr, false);
  });
  it('zero-weight sets are never PRs', () => {
    const r = checkPr({ weightKg: 0, reps: 10, previousBestE1Rm: null, previousBestWeightKg: null });
    assert.equal(r.isPr, false);
  });
});
