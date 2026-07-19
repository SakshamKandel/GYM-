import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { partnerBalance, validatePayoutAmount } from './payouts.ts';

describe('partnerBalance', () => {
  it('is all-zero for an empty ledger (never NaN)', () => {
    assert.deepEqual(partnerBalance([]), {
      earnedMinor: 0,
      adjustmentMinor: 0,
      paidMinor: 0,
      heldMinor: 0,
    });
  });
  it('held = earnings + adjustments − payouts', () => {
    assert.deepEqual(
      partnerBalance([
        { type: 'earning', amountMinor: 100_00 },
        { type: 'earning', amountMinor: 50_00 },
        { type: 'adjustment', amountMinor: -10_00 },
        { type: 'payout', amountMinor: 40_00 },
      ]),
      { earnedMinor: 150_00, adjustmentMinor: -10_00, paidMinor: 40_00, heldMinor: 100_00 },
    );
  });
  it('decrements held as payouts are written', () => {
    const before = partnerBalance([{ type: 'earning', amountMinor: 100_00 }]);
    const after = partnerBalance([
      { type: 'earning', amountMinor: 100_00 },
      { type: 'payout', amountMinor: 100_00 },
    ]);
    assert.equal(before.heldMinor, 100_00);
    assert.equal(after.heldMinor, 0);
  });
  it('truncates non-finite amounts to 0', () => {
    assert.equal(
      partnerBalance([{ type: 'earning', amountMinor: Number.NaN }]).heldMinor,
      0,
    );
  });
});

describe('validatePayoutAmount', () => {
  it('accepts a positive integer within held', () => {
    assert.deepEqual(validatePayoutAmount(50_00, 100_00), { ok: true });
    assert.deepEqual(validatePayoutAmount(100_00, 100_00), { ok: true });
  });
  it('rejects non-integers', () => {
    assert.deepEqual(validatePayoutAmount(1.5, 100_00), { ok: false, reason: 'not_integer' });
  });
  it('rejects zero and negatives', () => {
    assert.deepEqual(validatePayoutAmount(0, 100_00), { ok: false, reason: 'not_positive' });
    assert.deepEqual(validatePayoutAmount(-5, 100_00), { ok: false, reason: 'not_positive' });
  });
  it('rejects an over-draw beyond held (§7.2-S1)', () => {
    assert.deepEqual(validatePayoutAmount(100_01, 100_00), { ok: false, reason: 'exceeds_held' });
  });
});
