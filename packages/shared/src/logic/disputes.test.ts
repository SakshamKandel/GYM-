import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISPUTE_REASONS,
  DISPUTE_STATUSES,
  canAdvanceDispute,
  canOpenDispute,
  isDisputeReason,
  isLiveDisputeStatus,
  isTerminalDisputeStatus,
} from './disputes.ts';

describe('dispute reasons', () => {
  it('recognizes the closed set', () => {
    for (const r of DISPUTE_REASONS) assert.equal(isDisputeReason(r), true);
    assert.equal(isDisputeReason('refund_me'), false);
  });
});

describe('dispute state machine', () => {
  it('open → reviewing/resolved/rejected', () => {
    assert.equal(canAdvanceDispute('open', 'reviewing'), true);
    assert.equal(canAdvanceDispute('open', 'resolved'), true);
    assert.equal(canAdvanceDispute('open', 'rejected'), true);
  });
  it('reviewing → resolved/rejected only', () => {
    assert.equal(canAdvanceDispute('reviewing', 'resolved'), true);
    assert.equal(canAdvanceDispute('reviewing', 'rejected'), true);
    assert.equal(canAdvanceDispute('reviewing', 'open'), false);
  });
  it('resolved and rejected are terminal', () => {
    for (const s of ['resolved', 'rejected'] as const) {
      assert.equal(isTerminalDisputeStatus(s), true);
      for (const to of DISPUTE_STATUSES) assert.equal(canAdvanceDispute(s, to), false);
    }
  });
  it('open/reviewing are live (block a second file)', () => {
    assert.equal(isLiveDisputeStatus('open'), true);
    assert.equal(isLiveDisputeStatus('reviewing'), true);
    assert.equal(isLiveDisputeStatus('resolved'), false);
    assert.equal(isLiveDisputeStatus('rejected'), false);
  });
});

describe('canOpenDispute — terminal delivered/paid only (§7.2-S3)', () => {
  it('allows a delivered order', () => {
    assert.equal(canOpenDispute('delivered', 'unpaid'), true);
  });
  it('allows any paid order (money captured)', () => {
    assert.equal(canOpenDispute('cancelled', 'paid'), true);
    assert.equal(canOpenDispute('refused', 'paid'), true);
  });
  it('blocks an in-flight unpaid order', () => {
    assert.equal(canOpenDispute('pending', 'unpaid'), false);
    assert.equal(canOpenDispute('preparing', 'receipt_submitted'), false);
  });
});
