import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  atomicCycleReceiptSql,
  atomicSubscriptionSkipSql,
  mealCycleOperationLockSql,
} from './meals/skipRepricing.ts';

const dialect = new PgDialect();

describe('atomic subscription skip repricing', () => {
  it('inserts once, reprices only the inserted skip, and voids a zero-slot cycle', () => {
    const query = dialect.sqlToQuery(
      atomicSubscriptionSkipSql({
        skipId: 'skip-1',
        eventId: 'event-1',
        subscriptionId: 'sub-1',
        accountId: 'account-1',
        deliveryDate: '2026-07-22',
        weekStart: '2026-07-19',
        window: 'dinner',
        now: new Date('2026-07-19T06:00:00.000Z'),
      }),
    );

    assert.match(query.sql, /insert into meal_sub_skips/);
    assert.match(query.sql, /on conflict \(subscription_id, delivery_date\) do nothing/);
    assert.match(query.sql, /and exists \(select 1 from inserted_skip\)/);
    assert.match(query.sql, /planned_slots = greatest\(cycle\.planned_slots - 1, 0\)/);
    assert.match(
      query.sql,
      /amount_minor = greatest\(cycle\.planned_slots - 1, 0\) \* cycle\.price_per_day_minor/,
    );
    assert.match(query.sql, /then 'void'/);
    assert.match(query.sql, /when exists \(select 1 from existing_skip\) then 'duplicate'/);
  });

  it('locks payment state and cancels a pending slot in the same statement', () => {
    const query = dialect.sqlToQuery(
      atomicSubscriptionSkipSql({
        skipId: 'skip-2',
        eventId: 'event-2',
        subscriptionId: 'sub-2',
        accountId: 'account-2',
        deliveryDate: '2026-07-23',
        weekStart: '2026-07-19',
        window: 'lunch',
        now: new Date('2026-07-19T06:00:00.000Z'),
      }),
    );

    assert.match(query.sql, /from meal_billing_cycles[\s\S]*for update/);
    assert.match(query.sql, /from meal_orders[\s\S]*for update/);
    assert.match(query.sql, /request\.status = 'approved'/);
    assert.match(query.sql, /request\.status = 'pending'/);
    assert.match(query.sql, /update meal_orders order_row/);
    assert.match(query.sql, /order_row\.payment_status in \('unpaid', 'refunded'\)/);
    assert.match(query.sql, /insert into meal_order_events/);
  });
});

describe('cycle receipt serialization', () => {
  it('uses the same transaction lock key for a subscription week', () => {
    const query = dialect.sqlToQuery(mealCycleOperationLockSql('sub-1', '2026-07-19'));
    assert.match(query.sql, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
    assert.equal(query.params[0], 'meal-cycle:sub-1:2026-07-19');
  });

  it('copies the corrected live cycle amount and ignores rejected history', () => {
    const query = dialect.sqlToQuery(
      atomicCycleReceiptSql({
        requestId: 'request-1',
        cycleId: 'cycle-1',
        accountId: 'account-1',
        method: 'esewa',
        receiptUrl: 'meal_receipt/00000000-0000-0000-0000-000000000001',
        note: null,
        now: new Date('2026-07-19T00:00:00.000Z'),
      }),
    );

    assert.match(query.sql, /select[\s\S]*cycle\.amount_minor, cycle\.currency/);
    assert.match(query.sql, /status in \('pending', 'approved'\)/);
    assert.doesNotMatch(query.sql, /status in \('pending', 'approved', 'rejected'\)/);
    assert.match(query.sql, /cycle\.status = 'awaiting_payment'/);
    assert.match(query.sql, /cycle\.amount_minor > 0/);
  });
});
