import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canCreateSession } from './accountStatus.ts';

describe('canCreateSession', () => {
  it('allows active accounts', () => {
    assert.equal(canCreateSession('active'), true);
  });

  it('fails closed for suspended and unknown account states', () => {
    assert.equal(canCreateSession('suspended'), false);
    assert.equal(canCreateSession(''), false);
    assert.equal(canCreateSession('pending'), false);
  });
});
