import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { derivePartnerStoreState } from './partnerStoreState.ts';

describe('derivePartnerStoreState', () => {
  it('does not infer a store pause from sold-out items', () => {
    assert.deepEqual(
      derivePartnerStoreState([{ isActive: false }, { isActive: false }], true),
      { totalMeals: 2, activeMeals: 0, paused: false },
    );
  });

  it('preserves item availability while the partner switch is paused', () => {
    assert.deepEqual(
      derivePartnerStoreState([{ isActive: true }, { isActive: false }], false),
      { totalMeals: 2, activeMeals: 1, paused: true },
    );
  });
});
