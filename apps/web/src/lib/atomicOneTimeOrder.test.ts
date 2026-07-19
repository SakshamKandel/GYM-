import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { atomicOneTimeOrderSql } from './meals/atomicOneTimeOrder.ts';

describe('atomicOneTimeOrderSql', () => {
  it('keeps eligibility, order, every line, and the initial event in one statement', () => {
    const query = new PgDialect().sqlToQuery(
      atomicOneTimeOrderSql({
        orderId: 'order-1',
        eventId: 'event-1',
        accountId: 'account-1',
        partnerId: 'partner-1',
        requestId: '1788e8d8-a8d8-4b48-98d8-1788e8d8a8d8',
        requestFingerprint: 'f'.repeat(64),
        deliveryDate: '2026-07-20',
        window: 'lunch',
        addressId: 'address-1',
        deliveryName: 'Member',
        deliveryPhone: '9800000000',
        deliveryAddressText: 'Baluwatar',
        deliveryLat: 27.72,
        deliveryLng: 85.32,
        deliveryNotes: '',
        subtotalMinor: 10000,
        deliveryFeeMinor: 500,
        smallOrderFeeMinor: 0,
        tipMinor: 0,
        totalMinor: 10500,
        currency: 'NPR',
        paymentMethod: 'cod',
        cutoffAt: new Date('2026-07-20T04:15:00.000Z'),
        items: [
          {
            id: 'item-1',
            mealId: 'meal-1',
            nameSnapshot: 'Protein bowl',
            priceMinorSnapshot: 10000,
            macrosSnapshot: { kcal: 500, proteinG: 40, carbsG: 50, fatG: 15 },
            qty: 1,
          },
        ],
      }),
    );

    assert.match(query.sql, /is_active = true and accepting_orders = true/);
    assert.match(query.sql, /insert into meal_orders/);
    assert.match(query.sql, /tip_minor/);
    assert.match(query.sql, /insert into meal_order_items/);
    assert.match(query.sql, /insert into meal_order_events/);
    assert.match(query.sql, /from jsonb_to_recordset\(\$\d+::jsonb\)/);

    const encodedItems = query.params.find(
      (value): value is string => typeof value === 'string' && value.startsWith('[{"id":"item-1"'),
    );
    assert.ok(encodedItems);
    assert.deepEqual(JSON.parse(encodedItems), [
      {
        id: 'item-1',
        meal_id: 'meal-1',
        name_snapshot: 'Protein bowl',
        price_minor_snapshot: 10000,
        macros_snapshot: { kcal: 500, proteinG: 40, carbsG: 50, fatG: 15 },
        qty: 1,
      },
    ]);
  });
});
