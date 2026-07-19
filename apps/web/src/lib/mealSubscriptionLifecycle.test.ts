import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';

// @gym/shared's barrel uses extensionless relative exports (the repo-wide source
// idiom) which Node's native TS runner rejects on static resolution. Bridge them
// for this test process, then load the modules under test dynamically AFTER the
// hook is live — same pattern as mealSubscriptionEdit.test.ts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (typeof specifier === 'string') {
        if (specifier.startsWith('@/')) {
          const rebased = new URL(specifier.slice(2), new URL('../', import.meta.url)).href;
          try {
            return nextResolve(rebased, context);
          } catch {
            return nextResolve(rebased + '.ts', context);
          }
        }
        if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
          return nextResolve(specifier + '.ts', context);
        }
      }
      throw err;
    }
  },
});

const { ktmDayOfWeek } = await import('@gym/shared');
const { prorateUnusedPaidDays, upcomingDeliveryDates, buildCycleInvoice } = await import(
  './meals/subscriptionPlan.ts'
);
const { atomicCycleReceiptSql } = await import('./meals/skipRepricing.ts');
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();

describe('prorateUnusedPaidDays', () => {
  // 2026-07-19 is a Sunday (KTM week start); Mon=1 … Sat=6.
  const weekStart = '2026-07-19';
  const price = 25_000;

  it('refunds only strictly-future subscribed days, today/past are committed', () => {
    // Sub delivers Mon(1)/Wed(3)/Fri(5). "Today" = Wed → Mon & Wed committed,
    // Fri is the only unused day.
    const wed = '2026-07-22';
    const res = prorateUnusedPaidDays({
      weekStart,
      daysOfWeek: [1, 3, 5],
      pricePerDayMinor: price,
      amountMinor: 3 * price,
      today: wed,
    });
    assert.equal(res.unusedDays, 1);
    assert.equal(res.refundMinor, price);
  });

  it('excludes skipped days from the refund', () => {
    const sun = '2026-07-19';
    const res = prorateUnusedPaidDays({
      weekStart,
      daysOfWeek: [1, 3, 5],
      pricePerDayMinor: price,
      amountMinor: 3 * price,
      today: sun,
      skipDates: new Set(['2026-07-22']), // skip Wed
    });
    // Future subscribed days after Sun = Mon, Wed, Fri; minus skipped Wed = 2.
    assert.equal(res.unusedDays, 2);
    assert.equal(res.refundMinor, 2 * price);
  });

  it('clamps the refund to the cycle amount (never over-refunds)', () => {
    const sun = '2026-07-19';
    const res = prorateUnusedPaidDays({
      weekStart,
      daysOfWeek: [1, 3, 5],
      pricePerDayMinor: price,
      amountMinor: price, // cycle only funded one day (repriced)
      today: sun,
    });
    assert.equal(res.unusedDays, 3);
    assert.equal(res.refundMinor, price); // clamped
  });

  it('a fully-elapsed week refunds nothing', () => {
    const res = prorateUnusedPaidDays({
      weekStart,
      daysOfWeek: [1, 3, 5],
      pricePerDayMinor: price,
      amountMinor: 3 * price,
      today: '2026-07-27', // next week
    });
    assert.equal(res.unusedDays, 0);
    assert.equal(res.refundMinor, 0);
  });
});

describe('upcomingDeliveryDates', () => {
  it('projects subscribed weekdays from today, excludes skips, honours max', () => {
    const out = upcomingDeliveryDates({
      daysOfWeek: [1, 3, 5],
      window: 'lunch',
      startDate: '2026-07-01',
      fromDate: '2026-07-19',
      horizonDays: 14,
      skipDates: new Set(['2026-07-22']),
      max: 3,
    });
    assert.equal(out.length, 3);
    assert.ok(out.every((d) => [1, 3, 5].includes(ktmDayOfWeek(d.date))));
    assert.ok(out.every((d) => d.window === 'lunch'));
    assert.ok(!out.some((d) => d.date === '2026-07-22'));
    // Strictly increasing dates.
    for (let i = 1; i < out.length; i += 1) assert.ok(out[i]!.date > out[i - 1]!.date);
  });

  it('anchors on startDate when the plan has not started yet', () => {
    const out = upcomingDeliveryDates({
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      window: 'dinner',
      startDate: '2026-08-01',
      fromDate: '2026-07-19',
      horizonDays: 3,
      max: 5,
    });
    assert.ok(out.every((d) => d.date >= '2026-08-01'));
  });
});

describe('buildCycleInvoice', () => {
  it('projects a cycle row to the stable invoice shape', () => {
    const invoice = buildCycleInvoice({
      id: 'cycle-1',
      weekStart: '2026-07-19',
      weekEnd: '2026-07-25',
      plannedSlots: 3,
      pricePerDayMinor: 25_000,
      amountMinor: 75_000,
      currency: 'NPR',
      status: 'awaiting_payment',
    });
    assert.equal(invoice.cycleId, 'cycle-1');
    assert.equal(invoice.amountMinor, 75_000);
    assert.equal(invoice.status, 'awaiting_payment');
  });
});

describe('atomicCycleReceiptSql', () => {
  it('flips the cycle awaiting_payment → receipt_submitted on a successful insert', () => {
    const query = dialect.sqlToQuery(
      atomicCycleReceiptSql({
        requestId: 'req-1',
        cycleId: 'cycle-1',
        accountId: 'account-1',
        method: 'esewa',
        receiptUrl: 'meal_receipt/00000000-0000-0000-0000-000000000000',
        note: null,
        now: new Date('2026-07-19T00:00:00.000Z'),
      }),
    );
    assert.match(query.sql, /update meal_billing_cycles/);
    assert.match(query.sql, /set status = 'receipt_submitted'/);
    // The flip is gated on the insert actually happening.
    assert.match(query.sql, /exists \(select 1 from inserted_request\)/);
  });
});
