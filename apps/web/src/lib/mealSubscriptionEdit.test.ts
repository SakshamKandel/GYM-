import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';

// @gym/shared's barrel uses extensionless relative exports (the repo-wide
// source idiom) which Node's native TS runner rejects on static resolution.
// Bridge them for this test process, then load shared dynamically AFTER the
// hook is live — same pattern as packages/shared orders.test.ts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (typeof specifier === 'string') {
        // Next's '@/' src alias -> real file URL (with .ts retry).
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

const { DEFAULT_MEAL_DELIVERY_CONFIG } = await import('@gym/shared');
// Modules under test load dynamically too: their transitive imports (@gym/db
// -> './schema') resolve at graph-build time for static imports, before the
// hook exists.
const { guardedMealSoftDeleteSql } = await import('./meals/menuSubscriptionSafety.ts');
const { atomicSubscriptionCreateSql, atomicSubscriptionEditSql } = await import('./meals/subscriptionEdit.ts');
const { buildSubscriptionCycleAdjustments } = await import('./meals/subscriptionPlan.ts');
import { PgDialect } from 'drizzle-orm/pg-core';



const dialect = new PgDialect();

describe('subscription plan create/edit safety', () => {
  const shape = {
    daysOfWeek: [1, 3],
    window: 'lunch' as const,
    planType: 'fixed_meal' as const,
    mealId: 'meal-1',
    addressId: 'address-1',
  };

  it('revalidates the live fixed meal inside the locked create write', () => {
    const query = dialect.sqlToQuery(
      atomicSubscriptionCreateSql({
        id: 'sub-1',
        accountId: 'account-1',
        partnerId: 'partner-1',
        shape,
        pricePerDayMinor: 25_000,
        currency: 'NPR',
        paymentMethod: 'cod',
        startDate: '2026-07-20',
      }),
    );

    assert.match(query.sql, /insert into meal_subscriptions/);
    assert.match(query.sql, /partner\.accepting_orders = true/);
    assert.match(query.sql, /address\.account_id =/);
    assert.match(query.sql, /meal\.is_active = true/);
    assert.match(query.sql, /meal\.is_deleted = false/);
  });

  it('locks partner/cycles, protects money, preserves orders, and CAS-reprices cycles', () => {
    const query = dialect.sqlToQuery(
      atomicSubscriptionEditSql({
        subscriptionId: 'sub-1',
        accountId: 'account-1',
        partnerId: 'partner-1',
        expectedUpdatedAt: new Date('2026-07-19T00:00:00.000Z'),
        now: new Date('2026-07-19T01:00:00.000Z'),
        today: '2026-07-19',
        shape,
        pricePerDayMinor: 30_000,
        currency: 'NPR',
        cycleAdjustments: [
          {
            id: 'cycle-1',
            weekStart: '2026-07-19',
            expectedStatus: 'awaiting_payment',
            expectedPlannedSlots: 2,
            expectedUpdatedAt: new Date('2026-07-19T00:00:00.000Z'),
            plannedSlots: 1,
            nextStatus: 'awaiting_payment',
            amountMinor: 30_000,
          },
        ],
      }),
    );

    assert.match(query.sql, /pg_advisory_xact_lock\(hashtextextended/);
    assert.match(query.sql, /'meal-cycle:' \|\| cycle\.subscription_id/);
    assert.match(query.sql, /future_cycles[\s\S]*for update/);
    assert.match(query.sql, /request\.status in \('pending', 'approved'\)/);
    assert.match(query.sql, /then 'refund_required'/);
    assert.match(query.sql, /then 'payment_review_required'/);
    assert.match(query.sql, /sub\.updated_at =/);
    assert.match(query.sql, /jsonb_to_recordset/);
    assert.match(query.sql, /insert into meal_sub_skips/);
    assert.match(query.sql, /on conflict \(subscription_id, delivery_date\) do nothing/);
    assert.match(query.sql, /update meal_billing_cycles cycle/);
  });

  it('recomputes an unfunded cycle from schedule, skips, and live cutoffs', () => {
    const adjustments = buildSubscriptionCycleAdjustments({
      cycles: [
        {
          id: 'cycle-1',
          weekStart: '2026-07-19',
          status: 'awaiting_payment',
          plannedSlots: 2,
          updatedAt: new Date('2026-07-18T00:00:00.000Z'),
        },
      ],
      startDate: '2026-07-19',
      shape,
      pricePerDayMinor: 30_000,
      skipDates: new Set(['2026-07-20']),
      now: new Date('2026-07-18T00:00:00.000Z'),
      config: DEFAULT_MEAL_DELIVERY_CONFIG,
    });

    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0]?.plannedSlots, 1);
    assert.equal(adjustments[0]?.amountMinor, 30_000);
    assert.equal(adjustments[0]?.nextStatus, 'awaiting_payment');
  });
});

describe('fixed-plan menu removal guard', () => {
  it('counts active/paused references and only deletes at zero', () => {
    const query = dialect.sqlToQuery(
      guardedMealSoftDeleteSql({
        mealId: 'meal-1',
        partnerId: 'partner-1',
        now: new Date('2026-07-19T00:00:00.000Z'),
      }),
    );

    assert.match(query.sql, /subscription\.status in \('active', 'paused'\)/);
    assert.match(query.sql, /subscription\.plan_type = 'fixed_meal'/);
    assert.match(query.sql, /and \(select count from blockers\) = 0/);
    assert.match(query.sql, /then 'fixed_subscription_in_use'/);
  });
});
