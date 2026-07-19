import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mealOrderRequestFingerprint,
  mealOrderRequestIdSchema,
  resolveMealOrderIdempotency,
  type MealOrderFingerprintInput,
} from './mealOrderIdempotency.ts';

const requestId = '1788e8d8-a8d8-4b48-98d8-1788e8d8a8d8';
const input: MealOrderFingerprintInput = {
  partnerId: 'partner-1',
  deliveryDate: '2026-07-20',
  window: 'lunch',
  addressId: 'address-1',
  items: [
    { mealId: 'meal-b', qty: 2 },
    { mealId: 'meal-a', qty: 1 },
  ],
  paymentMethod: 'cod',
  notes: 'Ring the bell',
};

describe('meal order request id', () => {
  it('accepts UUID request ids and rejects malformed or unbounded keys', () => {
    assert.equal(mealOrderRequestIdSchema.safeParse(requestId).success, true);
    assert.equal(mealOrderRequestIdSchema.safeParse('checkout-1').success, false);
    assert.equal(mealOrderRequestIdSchema.safeParse('x'.repeat(500)).success, false);
  });
});

describe('mealOrderRequestFingerprint', () => {
  it('is stable across item ordering and insignificant note whitespace', () => {
    const first = mealOrderRequestFingerprint(input);
    const second = mealOrderRequestFingerprint({
      ...input,
      items: [...input.items].reverse(),
      notes: '  Ring the bell  ',
    });

    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(second, first);
  });

  it('changes when a meaningful order field changes', () => {
    const original = mealOrderRequestFingerprint(input);

    assert.notEqual(
      mealOrderRequestFingerprint({ ...input, addressId: 'address-2' }),
      original,
    );
    assert.notEqual(
      mealOrderRequestFingerprint({
        ...input,
        items: input.items.map((item) =>
          item.mealId === 'meal-a' ? { ...item, qty: item.qty + 1 } : item,
        ),
      }),
      original,
    );
    assert.notEqual(
      mealOrderRequestFingerprint({ ...input, paymentMethod: 'esewa' }),
      original,
    );
  });
});

describe('resolveMealOrderIdempotency', () => {
  it('creates for a fresh key, replays an identical payload, and conflicts otherwise', () => {
    const fingerprint = mealOrderRequestFingerprint(input);

    assert.equal(resolveMealOrderIdempotency(null, fingerprint), 'create');
    assert.equal(
      resolveMealOrderIdempotency({ requestFingerprint: fingerprint }, fingerprint),
      'replay',
    );
    assert.equal(
      resolveMealOrderIdempotency({ requestFingerprint: 'different' }, fingerprint),
      'conflict',
    );
    assert.equal(
      resolveMealOrderIdempotency({ requestFingerprint: null }, fingerprint),
      'conflict',
    );
  });
});
