import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TIP_MAX_MINOR, tipOptions, validateTipMinor } from './tips.ts';

describe('tipOptions', () => {
  it('computes each preset as a percentage of the subtotal', () => {
    assert.deepEqual(tipOptions(100_00), [
      { percent: 0, amountMinor: 0 },
      { percent: 10, amountMinor: 10_00 },
      { percent: 15, amountMinor: 15_00 },
      { percent: 20, amountMinor: 20_00 },
    ]);
  });
  it('rounds to the nearest minor unit', () => {
    // 15% of 333 = 49.95 → 50
    assert.equal(tipOptions(333).find((o) => o.percent === 15)?.amountMinor, 50);
  });
  it('collapses to a zero base for negative / NaN subtotals', () => {
    for (const bad of [-100, Number.NaN]) {
      assert.deepEqual(
        tipOptions(bad).map((o) => o.amountMinor),
        [0, 0, 0, 0],
      );
    }
  });
});

describe('validateTipMinor', () => {
  it('accepts a non-negative integer within cap', () => {
    assert.deepEqual(validateTipMinor(5_00, 100_00), { ok: true, tipMinor: 5_00 });
    assert.deepEqual(validateTipMinor(0), { ok: true, tipMinor: 0 });
  });
  it('rejects non-integers (fail-safe to 0)', () => {
    assert.deepEqual(validateTipMinor(1.5), { ok: false, tipMinor: 0, reason: 'not_integer' });
  });
  it('rejects negatives (no account credit — §7.2-S5)', () => {
    assert.deepEqual(validateTipMinor(-1), { ok: false, tipMinor: 0, reason: 'negative' });
  });
  it('rejects above the absolute cap when no subtotal given', () => {
    assert.deepEqual(validateTipMinor(TIP_MAX_MINOR + 1), {
      ok: false,
      tipMinor: 0,
      reason: 'exceeds_cap',
    });
  });
  it('applies the tighter 5x-subtotal relative cap', () => {
    // subtotal 100_00 → relative cap 500_00; 500_01 rejected, 500_00 accepted.
    assert.equal(validateTipMinor(500_01, 100_00).ok, false);
    assert.equal(validateTipMinor(500_00, 100_00).ok, true);
  });
});
