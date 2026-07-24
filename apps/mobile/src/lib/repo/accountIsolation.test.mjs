import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { useMealCart } from '../../features/meals/cartStore.ts';
import { questScopeId } from '../../state/questScope.ts';
import { isCurrentSessionRequest } from '../sessionRequest.ts';

describe('account-bound mobile state', () => {
  it('rejects late responses from an old token or an older same-token request', () => {
    const request = { token: 'member-a-token', sequence: 4 };

    assert.equal(
      isCurrentSessionRequest(request, { token: 'member-a-token', sequence: 4 }),
      true,
    );
    assert.equal(
      isCurrentSessionRequest(request, { token: 'member-b-token', sequence: 4 }),
      false,
    );
    assert.equal(
      isCurrentSessionRequest(request, { token: 'member-a-token', sequence: 5 }),
      false,
    );
    assert.equal(isCurrentSessionRequest(request, { token: null, sequence: 4 }), false);
  });

  it('clears both partner ownership and lines from the ephemeral meal cart', () => {
    useMealCart.getState().setPartner('partner-a');
    useMealCart.getState().setQty({ id: 'meal-a', priceMinor: 1200 }, 2);

    useMealCart.getState().clear();

    assert.equal(useMealCart.getState().partnerId, null);
    assert.deepEqual(useMealCart.getState().lines, {});
  });

  it('persists activation quests under distinct account namespaces', () => {
    assert.equal(questScopeId('member-a'), 'account:member-a');
    assert.equal(questScopeId('member-b'), 'account:member-b');
    assert.notEqual(questScopeId('member-a'), questScopeId('member-b'));
    assert.equal(questScopeId(null), 'anonymous');
  });
});
