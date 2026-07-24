import assert from 'node:assert/strict';
import test from 'node:test';
import { humanMessageDelivery } from './humanMessaging';

test('support messages always route to the persisted human support inbox', () => {
  assert.deepEqual(humanMessageDelivery('support', null), {
    ok: true,
    target: 'support_inbox',
  });
});

test('coach chat fails closed when no active human coach is assigned', () => {
  assert.deepEqual(humanMessageDelivery('coach_chat', null), {
    ok: false,
    error: 'coach_unavailable',
  });
});

test('coach chat routes only to the assigned coach account', () => {
  assert.deepEqual(humanMessageDelivery('coach_chat', 'coach_42'), {
    ok: true,
    target: 'assigned_coach',
    accountId: 'coach_42',
  });
});
