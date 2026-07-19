import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertAnonymousOwnerId,
  assertUsableOwnerId,
  isAnonymousOwnerId,
  isUsableOwnerId,
  LEGACY_QUARANTINE_OWNER_ID,
  ownerIdForAccount,
  ownerIdForAnonymousSession,
} from './ownership.ts';

describe('repository owner namespaces', () => {
  it('creates distinct immutable namespaces for accounts and anonymous sessions', () => {
    assert.equal(ownerIdForAccount('member-a'), 'account:member-a');
    assert.equal(ownerIdForAccount('member-b'), 'account:member-b');
    assert.equal(ownerIdForAnonymousSession('device-session'), 'anonymous:device-session');
  });

  it('never permits the legacy quarantine as an active repository owner', () => {
    assert.equal(isUsableOwnerId(LEGACY_QUARANTINE_OWNER_ID), false);
    assert.throws(() => assertUsableOwnerId(LEGACY_QUARANTINE_OWNER_ID));
  });

  it('never accepts an authenticated account as the signed-out namespace', () => {
    const accountOwner = ownerIdForAccount('member-a');
    assert.equal(isAnonymousOwnerId(accountOwner), false);
    assert.throws(() => assertAnonymousOwnerId(accountOwner));
    assert.doesNotThrow(() => assertAnonymousOwnerId(ownerIdForAnonymousSession('fresh')));
  });

  it('rejects empty identifiers instead of collapsing owners together', () => {
    assert.throws(() => ownerIdForAccount('   '));
    assert.throws(() => ownerIdForAnonymousSession(''));
    assert.equal(isUsableOwnerId('account:'), false);
    assert.equal(isUsableOwnerId('anonymous:'), false);
  });
});
