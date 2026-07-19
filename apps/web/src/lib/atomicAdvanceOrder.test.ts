import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { atomicAdvanceOrderSql } from './meals/advanceSql.ts';

const dialect = new PgDialect();

describe('atomicAdvanceOrderSql', () => {
  it('keeps the scoped CAS, payment backstop, and append-only event in one statement', () => {
    const query = dialect.sqlToQuery(
      atomicAdvanceOrderSql({
        eventId: 'event-1',
        orderId: 'order-1',
        expectedStatus: 'pending',
        toStatus: 'cancelled',
        actor: 'member',
        actorId: 'account-1',
        scope: { accountId: 'account-1', partnerId: 'partner-1' },
        cancelReason: 'Changed plans',
        now: new Date('2026-07-19T08:00:00.000Z'),
      }),
    );

    assert.match(query.sql, /^\s*with updated_order as \(/);
    assert.match(query.sql, /update "meal_orders"/);
    assert.match(query.sql, /status_version = status_version \+ 1/);
    assert.match(query.sql, /cancelled_at = \$\d+/);
    assert.match(query.sql, /cancel_reason = \$\d+/);
    assert.match(query.sql, /where id = \$\d+ and status = \$\d+/);
    assert.match(query.sql, /partner_id = \$\d+/);
    assert.match(query.sql, /account_id = \$\d+/);
    assert.match(query.sql, /payment_status in \('unpaid', 'refunded'\)/);
    assert.match(query.sql, /insert into "meal_order_events"/);
    assert.match(query.sql, /select[\s\S]*updated_order\.id[\s\S]*from updated_order/);
    assert.match(query.sql, /updated_order\.account_id as "accountId"/);
    assert.match(query.sql, /updated_order\.status_version as "statusVersion"/);
    assert.match(query.sql, /updated_order\.updated_at as "updatedAt"/);
    assert.match(
      query.sql,
      /inner join inserted_event on inserted_event\.order_id = updated_order\.id\s*$/,
    );

    assert.ok(query.params.includes('event-1'));
    assert.ok(query.params.includes('order-1'));
    assert.ok(query.params.includes('account-1'));
    assert.ok(query.params.includes('partner-1'));
    assert.ok(query.params.includes('Changed plans'));
  });

  it('does not apply the destructive payment predicate to ordinary progress', () => {
    const query = dialect.sqlToQuery(
      atomicAdvanceOrderSql({
        eventId: 'event-2',
        orderId: 'order-2',
        expectedStatus: 'preparing',
        toStatus: 'out_for_delivery',
        actor: 'partner',
        actorId: 'partner-account-1',
        scope: { partnerId: 'partner-1' },
        now: new Date('2026-07-19T08:15:00.000Z'),
      }),
    );

    assert.doesNotMatch(query.sql, /payment_status in/);
    assert.doesNotMatch(query.sql, /cancelled_at =/);
    assert.doesNotMatch(query.sql, /delivered_at =/);
    assert.match(query.sql, /insert into "meal_order_events"/);
  });

  it('stamps only the timestamp owned by the requested transition', () => {
    const confirmed = dialect.sqlToQuery(
      atomicAdvanceOrderSql({
        eventId: 'event-3',
        orderId: 'order-3',
        expectedStatus: 'pending',
        toStatus: 'confirmed',
        actor: 'partner',
        actorId: 'partner-account-1',
        now: new Date('2026-07-19T08:30:00.000Z'),
      }),
    ).sql;
    assert.match(confirmed, /confirmed_at = \$\d+/);
    assert.doesNotMatch(confirmed, /delivered_at =/);
    assert.doesNotMatch(confirmed, /cancelled_at =/);

    const delivered = dialect.sqlToQuery(
      atomicAdvanceOrderSql({
        eventId: 'event-4',
        orderId: 'order-4',
        expectedStatus: 'out_for_delivery',
        toStatus: 'delivered',
        actor: 'partner',
        actorId: 'partner-account-1',
        now: new Date('2026-07-19T08:45:00.000Z'),
      }),
    ).sql;
    assert.match(delivered, /delivered_at = \$\d+/);
    assert.doesNotMatch(delivered, /confirmed_at =/);
    assert.doesNotMatch(delivered, /cancelled_at =/);
  });
});
