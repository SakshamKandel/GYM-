import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareTiers, effectiveTier, hasEntitlement } from './entitlements.ts';

const NOW = new Date('2026-07-04T12:00:00.000Z');

describe('effectiveTier', () => {
  it('null expiry keeps the stored paid tier (permanent)', () => {
    assert.equal(effectiveTier('elite', null, NOW), 'elite');
    assert.equal(effectiveTier('gold', undefined, NOW), 'gold');
    assert.equal(effectiveTier('silver', null, NOW), 'silver');
  });

  it('starter is always starter regardless of expiry', () => {
    assert.equal(effectiveTier('starter', null, NOW), 'starter');
    assert.equal(
      effectiveTier('starter', new Date('2020-01-01T00:00:00Z'), NOW),
      'starter',
    );
    assert.equal(
      effectiveTier('starter', new Date('2099-01-01T00:00:00Z'), NOW),
      'starter',
    );
  });

  it('future expiry keeps the stored paid tier', () => {
    assert.equal(
      effectiveTier('elite', new Date('2026-08-04T12:00:00Z'), NOW),
      'elite',
    );
  });

  it('past expiry collapses a paid tier to starter', () => {
    assert.equal(
      effectiveTier('elite', new Date('2026-07-04T11:59:59Z'), NOW),
      'starter',
    );
    assert.equal(
      effectiveTier('gold', new Date('2026-06-01T00:00:00Z'), NOW),
      'starter',
    );
  });

  it('expiry exactly at now is still valid (inclusive final instant)', () => {
    assert.equal(effectiveTier('elite', new Date(NOW.getTime()), NOW), 'elite');
  });

  it('accepts an ISO string expiry (the JSON shape)', () => {
    assert.equal(effectiveTier('elite', '2026-08-04T12:00:00.000Z', NOW), 'elite');
    assert.equal(effectiveTier('elite', '2026-01-01T00:00:00.000Z', NOW), 'starter');
  });

  it('unparseable expiry string fails OPEN to the stored tier', () => {
    assert.equal(effectiveTier('elite', 'not-a-date', NOW), 'elite');
  });

  it('an expired elite genuinely loses the elite entitlement downstream', () => {
    const eff = effectiveTier('elite', new Date('2026-06-01T00:00:00Z'), NOW);
    assert.equal(hasEntitlement({ tier: eff }, 'coach_chat'), false);
    assert.equal(compareTiers(eff, 'elite') < 0, true);
  });
});
