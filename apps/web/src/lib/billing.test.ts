import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { billingMode, verifyRevenueCatSignature } from './billing.ts';

describe('billingMode', () => {
  it('is disabled when configuration is absent or incomplete', () => {
    assert.equal(billingMode({}), 'disabled');
    assert.equal(billingMode({ BILLING_MODE: 'live' }), 'disabled');
  });

  it('enables live mode only with the mandatory webhook credential', () => {
    assert.equal(
      billingMode({ BILLING_MODE: 'live', REVENUECAT_WEBHOOK_AUTH: 'secret' }),
      'live',
    );
  });

  it('allows preview only when explicitly selected outside production', () => {
    assert.equal(billingMode({ BILLING_MODE: 'preview', NODE_ENV: 'development' }), 'preview');
    assert.equal(billingMode({ BILLING_MODE: 'preview', NODE_ENV: 'production' }), 'disabled');
  });
});

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
