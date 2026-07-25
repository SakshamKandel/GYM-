import assert from 'node:assert/strict';
import test from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { atomicAdvanceOrderSql } from './advanceSql.ts';
import { codDeliveredBackfillSql, codDeliveredPreviewSql } from './codBackfillSql.ts';
import { guardedMealPatchSql } from './menuSubscriptionSafety.ts';
import { guardedOrderItemInsertSql } from './orderItemsSql.ts';
import { pgIntArray, pgTextArray } from './pgArray.ts';

/**
 * These are money-path invariants, so they are asserted on the SQL the builders
 * emit rather than on a live database: the guards ARE the WHERE clauses.
 *
 * NOTE: every module reachable from here must spell its relative imports with an
 * explicit `.ts` extension — node's type-stripping ESM loader needs full
 * specifiers. The web test script globs `src/lib/**\/*.test.ts`; it used to glob
 * `src/lib/*.test.ts`, which silently skipped this whole file.
 */

const dialect = new PgDialect();
const render = (query: SQL): string => dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ');

const baseAdvance = {
  orderId: 'order_1',
  actor: 'admin' as const,
  actorId: 'staff_1',
  now: new Date('2026-07-25T00:00:00Z'),
  eventId: 'event_1',
};

test('an ordinary cancel still refuses to strand captured money', () => {
  const query = render(
    atomicAdvanceOrderSql({
      ...baseAdvance,
      expectedStatus: 'pending',
      toStatus: 'cancelled',
      actor: 'member',
    }),
  );
  assert.ok(query.includes("payment_status in ('unpaid', 'refunded')"));
  assert.ok(!query.includes("payment_status = 'paid'"));
  assert.ok(!query.includes("payment_status = 'refunded'"));
});

test('a forced reversal reverses payment and cancels in one compare-and-set', () => {
  const query = render(
    atomicAdvanceOrderSql({
      ...baseAdvance,
      expectedStatus: 'preparing',
      toStatus: 'cancelled',
      reversePayment: true,
      cancelReason: 'kitchen fire',
    }),
  );
  // Guard: captured money only — disjoint from the ordinary guard above.
  assert.ok(query.includes("payment_status = 'paid'"));
  assert.ok(!query.includes("payment_status in ('unpaid', 'refunded')"));
  // Same statement writes the reversal…
  assert.ok(query.includes("set status = $1"));
  assert.ok(query.includes("payment_status = 'refunded'"));
  // …and the append-only event.
  assert.ok(query.includes('insert into "meal_order_events"'));
});

test('the reversal flag can never fire on a non-destructive transition', () => {
  const query = render(
    atomicAdvanceOrderSql({
      ...baseAdvance,
      expectedStatus: 'pending',
      toStatus: 'confirmed',
      reversePayment: true,
    }),
  );
  assert.ok(!query.includes("payment_status = 'refunded'"));
  assert.ok(!query.includes("payment_status = 'paid'"));
});

test('deactivating a meal is blocked by live fixed-meal plans', () => {
  const query = render(
    guardedMealPatchSql({
      mealId: 'meal_1',
      partnerId: 'partner_1',
      now: new Date('2026-07-25T00:00:00Z'),
      patch: { isActive: false },
    }),
  );
  assert.ok(query.includes("subscription.plan_type = 'fixed_meal'"));
  assert.ok(query.includes("subscription.status in ('active', 'paused')"));
  assert.ok(query.includes('(select count from blockers) = 0'));
  assert.ok(query.includes("then 'fixed_subscription_in_use'"));
});

test('other menu edits are never blocked by subscribers', () => {
  const query = render(
    guardedMealPatchSql({
      mealId: 'meal_1',
      partnerId: 'partner_1',
      now: new Date('2026-07-25T00:00:00Z'),
      patch: { priceMinor: 450, isActive: true },
    }),
  );
  assert.ok(query.includes('select 0::integer as count'));
  assert.ok(!query.includes('meal_subscriptions'));
});

test('the line-item backfill is conditional in SQL', () => {
  const query = render(
    guardedOrderItemInsertSql({
      itemId: 'item_1',
      orderId: 'order_1',
      mealId: 'meal_1',
      nameSnapshot: 'Dal bhat',
      priceMinorSnapshot: 25000,
      macrosSnapshot: { kcal: 700, proteinG: 30, carbsG: 90, fatG: 20 },
      qty: 1,
    }),
  );
  assert.ok(query.includes('where not exists ( select 1 from meal_order_items'));
});

test('delivering a cash order closes its payment in the same statement', () => {
  // The forward half of the same invariant the backfill below closes for orders
  // delivered before this existed: for cash the money changes hands at the door.
  const query = render(
    atomicAdvanceOrderSql({
      ...baseAdvance,
      expectedStatus: 'out_for_delivery',
      toStatus: 'delivered',
      actor: 'partner',
    }),
  );
  assert.ok(query.includes("when payment_method = 'cod' and payment_status = 'unpaid' then 'paid'"));
  assert.ok(query.includes('else payment_status end'));

  // Nothing else in the machine touches payment on the way through.
  const confirmed = render(
    atomicAdvanceOrderSql({ ...baseAdvance, expectedStatus: 'pending', toStatus: 'confirmed' }),
  );
  assert.ok(!confirmed.includes('payment_status ='));
});

test('the cash backfill only closes delivered cash orders that are still unpaid', () => {
  const query = render(codDeliveredBackfillSql());
  assert.ok(query.includes("set payment_status = 'paid'"));
  assert.ok(query.includes("status = 'delivered'"));
  assert.ok(query.includes("payment_method = 'cod'"));
  assert.ok(query.includes("payment_status = 'unpaid'"));
  // A digital order's paid flip belongs to receipt approval, never to this.
  assert.ok(!query.includes('esewa'));
  assert.ok(!query.includes('khalti'));
  // The order's own status, and the version the tip CAS rides on, are untouched.
  assert.ok(!query.includes('set status'));
  assert.ok(!query.includes('status_version'));
});

test('the cash backfill counts exactly the rows it writes', () => {
  const whereClause = (query: string): string => {
    const at = query.indexOf(' where ');
    assert.ok(at > -1, 'expected a where clause');
    return query.slice(at + ' where '.length).split(' returning ')[0].split(' group by ')[0];
  };
  assert.equal(
    whereClause(render(codDeliveredPreviewSql())),
    whereClause(render(codDeliveredBackfillSql())),
  );

  const scoped = { before: '2026-07-01' };
  const scopedPreview = whereClause(render(codDeliveredPreviewSql(scoped)));
  assert.ok(scopedPreview.includes('delivery_date < $1::date'));
  assert.equal(scopedPreview, whereClause(render(codDeliveredBackfillSql(scoped))));
  assert.deepEqual(dialect.sqlToQuery(codDeliveredBackfillSql(scoped)).params, ['2026-07-01']);
});

test('re-running the cash backfill is a no-op, because paid rows no longer match', () => {
  // The predicate is the idempotency: there is no marker column to forget.
  const query = render(codDeliveredBackfillSql());
  const target = query.slice(query.indexOf(' where '));
  assert.ok(target.includes("payment_status = 'unpaid'"));
  assert.ok(!target.includes("payment_status = 'paid'"));
});

test('arrays bind as one array parameter, not a row constructor', () => {
  const ints = dialect.sqlToQuery(pgIntArray([1, 3, 5]));
  assert.equal(ints.sql, '$1::integer[]');
  assert.deepEqual(ints.params, ['{1,3,5}']);

  const texts = dialect.sqlToQuery(pgTextArray(['meal_1', 'meal_2']));
  assert.equal(texts.sql, '$1::text[]');
  assert.deepEqual(texts.params, ['{"meal_1","meal_2"}']);

  assert.deepEqual(dialect.sqlToQuery(pgIntArray([])).params, ['{}']);
  assert.throws(() => pgIntArray([1.5]), TypeError);
});
