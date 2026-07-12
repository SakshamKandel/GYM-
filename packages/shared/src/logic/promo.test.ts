import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generatePromoCode, normalizePromoCode } from './promo.ts';

const CODE_PATTERN = /^[A-Z0-9]+$/;

describe('generatePromoCode', () => {
  it('always yields 6-12 uppercase alphanumeric characters', () => {
    const names = ['Greece Maharjan', 'Jo', '', '123456', 'A', "O'Brien-Smith", 'x'.repeat(50)];
    for (const name of names) {
      const code = generatePromoCode(name);
      assert.match(code, CODE_PATTERN);
      assert.ok(code.length >= 6 && code.length <= 12, `${name} -> ${code}`);
    }
  });

  it('a normal-length name becomes BASE + 2 digits, unpadded/untruncated', () => {
    const code = generatePromoCode('Greece');
    assert.equal(code.length, 8); // 'GREECE' (6) + 2 digits
    assert.ok(code.startsWith('GREECE'));
    assert.match(code.slice(6), /^\d{2}$/);
  });

  it('strips non-letters and uppercases before basing the code', () => {
    const code = generatePromoCode("o'brien");
    assert.ok(code.startsWith('OBRIEN'));
  });

  it('falls back to COACH when the name has no letters at all', () => {
    assert.ok(generatePromoCode('123456').startsWith('COACH'));
    assert.ok(generatePromoCode('').startsWith('COACH'));
    assert.ok(generatePromoCode('   ').startsWith('COACH'));
  });

  it('truncates long names to a 10-char base (12 chars total)', () => {
    const code = generatePromoCode('Bartholomew Higginbottom');
    assert.equal(code.length, 12);
    assert.ok(code.startsWith('BARTHOLOME')); // first 10 letters of the stripped name
  });

  it('pads short names up to the 4-char minimum base', () => {
    const code = generatePromoCode('Jo');
    assert.equal(code.length, 6); // 4-char padded base + 2 digits
    assert.ok(code.startsWith('JO'));
  });

  it('the trailing 2 digits vary across calls (not hardcoded)', () => {
    const codes = new Set(Array.from({ length: 30 }, () => generatePromoCode('Greece')));
    assert.ok(codes.size > 1, 'expected at least some variation across 30 draws');
  });
});

describe('normalizePromoCode', () => {
  it('trims and uppercases valid input', () => {
    assert.equal(normalizePromoCode(' greece30 '), 'GREECE30');
    assert.equal(normalizePromoCode('AbCd'), 'ABCD');
  });

  it('accepts the 4-char and 16-char boundary lengths', () => {
    assert.equal(normalizePromoCode('ABCD'), 'ABCD');
    assert.equal(normalizePromoCode('A'.repeat(16)), 'A'.repeat(16));
  });

  it('rejects too-short (<4) and too-long (>16) input', () => {
    assert.equal(normalizePromoCode('ABC'), null);
    assert.equal(normalizePromoCode('A'.repeat(17)), null);
    assert.equal(normalizePromoCode(''), null);
  });

  it('rejects characters outside [A-Z0-9]', () => {
    assert.equal(normalizePromoCode('GREECE-30'), null);
    assert.equal(normalizePromoCode('GREECE 30'), null);
    assert.equal(normalizePromoCode('GRÉÉCE30'), null);
  });
});
