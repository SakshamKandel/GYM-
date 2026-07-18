import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MEAL_DELIVERY_CONFIG,
  computeFees,
  cutoffFor,
  earliestOrderableSlot,
  isMealAvailableForDate,
  isMealAvailableOn,
  isSlotOrderable,
  ktmAddDays,
  ktmDateString,
  ktmDayOfWeek,
  type MealAvailabilitySlot,
} from './meals.ts';

// A UTC instant for a given KTM wall-clock time (KTM = UTC+5:45).
function ktm(y: number, mo: number, da: number, hh: number, mm = 0): Date {
  return new Date(Date.UTC(y, mo - 1, da, hh, mm) - 345 * 60_000);
}

describe('KTM calendar helpers', () => {
  it('ktmDateString reflects the +5:45 shift across the UTC midnight boundary', () => {
    // 2026-07-18 23:00 UTC = 2026-07-19 04:45 KTM.
    assert.equal(ktmDateString(new Date(Date.UTC(2026, 6, 18, 23, 0))), '2026-07-19');
    // 2026-07-18 18:00 UTC = 2026-07-18 23:45 KTM (still the 18th).
    assert.equal(ktmDateString(new Date(Date.UTC(2026, 6, 18, 18, 0))), '2026-07-18');
    // 2026-07-18 18:20 UTC = 2026-07-19 00:05 KTM (rolls to the 19th).
    assert.equal(ktmDateString(new Date(Date.UTC(2026, 6, 18, 18, 20))), '2026-07-19');
  });
  it('ktmAddDays normalizes across month and year ends', () => {
    assert.equal(ktmAddDays('2026-07-31', 1), '2026-08-01');
    assert.equal(ktmAddDays('2026-01-01', -1), '2025-12-31');
    assert.equal(ktmAddDays('2026-03-01', -1), '2026-02-28');
  });
  it('ktmDayOfWeek: 0=Sun … 6=Sat', () => {
    assert.equal(ktmDayOfWeek('2026-07-19'), 0); // Sunday
    assert.equal(ktmDayOfWeek('2026-07-18'), 6); // Saturday
    assert.equal(ktmDayOfWeek('2026-07-20'), 1); // Monday
  });
});

describe('cutoffFor', () => {
  it('lunch = 21:00 KTM the previous day', () => {
    assert.equal(cutoffFor('2026-07-18', 'lunch').getTime(), ktm(2026, 7, 17, 21, 0).getTime());
  });
  it('dinner = 10:00 KTM the same day', () => {
    assert.equal(cutoffFor('2026-07-18', 'dinner').getTime(), ktm(2026, 7, 18, 10, 0).getTime());
  });
  it('lunch cutoff rolls back across a month boundary', () => {
    assert.equal(cutoffFor('2026-08-01', 'lunch').getTime(), ktm(2026, 7, 31, 21, 0).getTime());
  });
});

describe('isSlotOrderable', () => {
  it('true strictly before the cutoff, false at/after', () => {
    const date = '2026-07-18';
    // dinner cutoff = 2026-07-18 10:00 KTM.
    assert.equal(isSlotOrderable(date, 'dinner', ktm(2026, 7, 18, 9, 59)), true);
    assert.equal(isSlotOrderable(date, 'dinner', ktm(2026, 7, 18, 10, 0)), false);
    assert.equal(isSlotOrderable(date, 'dinner', ktm(2026, 7, 18, 10, 1)), false);
  });
});

describe('earliestOrderableSlot', () => {
  it('at 08:00 KTM today, today-dinner (cutoff 10:00) is still open', () => {
    const slot = earliestOrderableSlot(ktm(2026, 7, 18, 8, 0));
    // today-lunch cutoff was yesterday 21:00 (passed) → first open is today dinner.
    assert.deepEqual(slot, { date: '2026-07-18', window: 'dinner' });
  });
  it('at 11:00 KTM (past dinner cutoff), first open is tomorrow lunch', () => {
    const slot = earliestOrderableSlot(ktm(2026, 7, 18, 11, 0));
    // tomorrow-lunch cutoff = today 21:00, still ahead.
    assert.deepEqual(slot, { date: '2026-07-19', window: 'lunch' });
  });
  it('at 22:00 KTM (past tomorrow-lunch cutoff), first open is tomorrow dinner', () => {
    const slot = earliestOrderableSlot(ktm(2026, 7, 18, 22, 0));
    assert.deepEqual(slot, { date: '2026-07-19', window: 'dinner' });
  });
});

describe('computeFees', () => {
  const cfg = DEFAULT_MEAL_DELIVERY_CONFIG;
  it('small-order surcharge below the threshold, flat delivery', () => {
    // subtotal Rs300 (30000) < Rs500 threshold and < Rs1000 free-delivery.
    assert.deepEqual(computeFees(30000, cfg), {
      smallOrderFeeMinor: 5000,
      deliveryFeeMinor: 5000,
      totalMinor: 40000,
    });
  });
  it('no small-order fee at/above the threshold', () => {
    // subtotal Rs500 (50000) == threshold → no small fee, still pays delivery.
    assert.deepEqual(computeFees(50000, cfg), {
      smallOrderFeeMinor: 0,
      deliveryFeeMinor: 5000,
      totalMinor: 55000,
    });
  });
  it('free delivery at/above the free threshold', () => {
    // subtotal Rs1000 (100000) → free delivery, no small fee.
    assert.deepEqual(computeFees(100000, cfg), {
      smallOrderFeeMinor: 0,
      deliveryFeeMinor: 0,
      totalMinor: 100000,
    });
  });
  it('defaults the config when omitted', () => {
    assert.deepEqual(computeFees(30000), computeFees(30000, cfg));
  });
});

describe('availability', () => {
  const avail: MealAvailabilitySlot[] = [
    { dayOfWeek: 1, window: 'lunch' },
    { dayOfWeek: 1, window: 'dinner' },
    { dayOfWeek: 3, window: 'lunch' },
  ];
  it('empty availability = always available', () => {
    assert.equal(isMealAvailableOn([], 0, 'lunch'), true);
    assert.equal(isMealAvailableOn([], 5, 'dinner'), true);
  });
  it('matches only listed (day,window) pairs', () => {
    assert.equal(isMealAvailableOn(avail, 1, 'lunch'), true);
    assert.equal(isMealAvailableOn(avail, 1, 'dinner'), true);
    assert.equal(isMealAvailableOn(avail, 3, 'dinner'), false);
    assert.equal(isMealAvailableOn(avail, 2, 'lunch'), false);
  });
  it('isMealAvailableForDate resolves the weekday from a KTM date', () => {
    // 2026-07-20 is a Monday (dow 1).
    assert.equal(isMealAvailableForDate(avail, '2026-07-20', 'lunch'), true);
    assert.equal(isMealAvailableForDate(avail, '2026-07-20', 'dinner'), true);
    // 2026-07-21 is a Tuesday (dow 2) — not listed.
    assert.equal(isMealAvailableForDate(avail, '2026-07-21', 'lunch'), false);
  });
});
