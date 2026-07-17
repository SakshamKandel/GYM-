import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { verifyRevenueCatSignature } from './billing.ts';

describe('verifyRevenueCatSignature', () => {
  const secret = 'test-webhook-secret';
  const timestamp = '1784268000';
  const nowMs = Number(timestamp) * 1_000;
  const body = '{"event":{"id":"evt_123"}}';
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  it('accepts a current valid v1 signature', () => {
    assert.equal(
      verifyRevenueCatSignature(body, `t=${timestamp},v1=${signature}`, { secret, nowMs }),
      true,
    );
  });

  it('rejects body tampering and stale signatures', () => {
    assert.equal(
      verifyRevenueCatSignature(`${body} `, `t=${timestamp},v1=${signature}`, { secret, nowMs }),
      false,
    );
    assert.equal(
      verifyRevenueCatSignature(body, `t=${timestamp},v1=${signature}`, {
        secret,
        nowMs: nowMs + 6 * 60 * 1_000,
      }),
      false,
    );
  });

  it('is optional when no signing secret is configured', () => {
    assert.equal(verifyRevenueCatSignature(body, null, { secret: '' }), true);
  });
});
