import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCalendarMonths, planPaidTierWindow } from './paymentWindow.ts';

describe('addCalendarMonths', () => {
  it('clamps month-end dates and preserves the time', () => {
    const result = addCalendarMonths(new Date('2025-01-31T18:45:12.123Z'), 1);
    assert.equal(result.toISOString(), '2025-02-28T18:45:12.123Z');
  });

  it('uses leap day and treats twelve months as a calendar year', () => {
    assert.equal(
      addCalendarMonths(new Date('2024-01-31T00:00:00.000Z'), 1).toISOString(),
      '2024-02-29T00:00:00.000Z',
    );
    assert.equal(
      addCalendarMonths(new Date('2024-02-29T00:00:00.000Z'), 12).toISOString(),
      '2025-02-28T00:00:00.000Z',
    );
  });
});

describe('planPaidTierWindow', () => {
  const now = new Date('2026-07-17T05:00:00.000Z');

  it('extends the same active tier from its current expiry', () => {
    const plan = planPaidTierWindow(
      'gold',
      new Date('2026-08-31T05:00:00.000Z'),
      'gold',
      1,
      now,
    );
    assert.equal(plan.action, 'extend');
    assert.equal(plan.startsAt, undefined);
    assert.equal(plan.expiresAt.toISOString(), '2026-09-30T05:00:00.000Z');
    assert.equal(plan.needsConfirm, false);
  });

  it('requires confirmation before shortening a permanent tier', () => {
    const plan = planPaidTierWindow('gold', null, 'gold', 1, now);
    assert.equal(plan.needsConfirm, true);
    assert.equal(plan.confirmReason, 'permanent_current');
    assert.equal(plan.action, 'overwrite');
  });

  it('requires confirmation before downgrading a higher active tier', () => {
    const plan = planPaidTierWindow(
      'elite',
      new Date('2027-01-01T00:00:00.000Z'),
      'silver',
      3,
      now,
    );
    assert.equal(plan.needsConfirm, true);
    assert.equal(plan.confirmReason, 'higher_current');
  });

  it('overwrites an expired tier from now without confirmation', () => {
    const plan = planPaidTierWindow(
      'elite',
      new Date('2026-07-16T00:00:00.000Z'),
      'silver',
      1,
      now,
    );
    assert.equal(plan.needsConfirm, false);
    assert.equal(plan.startsAt, now);
    assert.equal(plan.expiresAt.toISOString(), '2026-08-17T05:00:00.000Z');
  });
});
