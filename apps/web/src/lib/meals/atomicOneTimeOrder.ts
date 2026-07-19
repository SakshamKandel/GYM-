import type { MealMacrosSnapshot } from '@gym/db';
import { sql, type SQL } from 'drizzle-orm';

export interface AtomicOneTimeOrderItem {
  id: string;
  mealId: string;
  nameSnapshot: string;
  priceMinorSnapshot: number;
  macrosSnapshot: MealMacrosSnapshot;
  qty: number;
}

export interface AtomicOneTimeOrderWrite {
  orderId: string;
  eventId: string;
  accountId: string;
  partnerId: string;
  requestId: string;
  requestFingerprint: string;
  deliveryDate: string;
  window: 'lunch' | 'dinner';
  addressId: string;
  deliveryName: string;
  deliveryPhone: string;
  deliveryAddressText: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryNotes: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  smallOrderFeeMinor: number;
  totalMinor: number;
  currency: 'NPR' | 'USD';
  paymentMethod: 'esewa' | 'khalti' | 'cod';
  cutoffAt: Date;
  items: readonly AtomicOneTimeOrderItem[];
}

/**
 * Build the one-statement persistence half of a one-time order creation.
 * Callers must execute it after `partnerOperationLockSql(partnerId)` in the
 * same Neon batch transaction. Zero returned rows means the partner stopped
 * accepting orders before the write snapshot.
 */
export function atomicOneTimeOrderSql(args: AtomicOneTimeOrderWrite): SQL {
  const itemPayload = JSON.stringify(
    args.items.map((item) => ({
      id: item.id,
      meal_id: item.mealId,
      name_snapshot: item.nameSnapshot,
      price_minor_snapshot: item.priceMinorSnapshot,
      macros_snapshot: item.macrosSnapshot,
      qty: item.qty,
    })),
  );

  return sql`
    with active_partner as materialized (
      select id
      from meal_partners
      where id = ${args.partnerId} and is_active = true and accepting_orders = true
    ),
    inserted_order as (
      insert into meal_orders (
        id, account_id, partner_id, source, subscription_id, cycle_id,
        client_request_id, request_fingerprint, delivery_date, window,
        address_id, delivery_name, delivery_phone, delivery_address_text,
        delivery_lat, delivery_lng, delivery_notes, subtotal_minor,
        delivery_fee_minor, small_order_fee_minor, total_minor, currency,
        payment_method, payment_status, status, status_version, cutoff_at
      )
      select
        ${args.orderId}, ${args.accountId}, ${args.partnerId}, 'one_time', null, null,
        ${args.requestId}, ${args.requestFingerprint}, ${args.deliveryDate}, ${args.window},
        ${args.addressId}, ${args.deliveryName}, ${args.deliveryPhone},
        ${args.deliveryAddressText}, ${args.deliveryLat}, ${args.deliveryLng},
        ${args.deliveryNotes}, ${args.subtotalMinor}, ${args.deliveryFeeMinor},
        ${args.smallOrderFeeMinor}, ${args.totalMinor}, ${args.currency},
        ${args.paymentMethod}, 'unpaid', 'pending', 0, ${args.cutoffAt}
      from active_partner
      returning id
    ),
    inserted_items as (
      insert into meal_order_items (
        id, order_id, meal_id, name_snapshot, price_minor_snapshot,
        macros_snapshot, qty
      )
      select
        item.id, inserted_order.id, item.meal_id, item.name_snapshot,
        item.price_minor_snapshot, item.macros_snapshot, item.qty
      from jsonb_to_recordset(${itemPayload}::jsonb) as item(
        id text,
        meal_id text,
        name_snapshot text,
        price_minor_snapshot integer,
        macros_snapshot jsonb,
        qty integer
      )
      cross join inserted_order
      returning id
    ),
    inserted_event as (
      insert into meal_order_events (
        id, order_id, from_status, to_status, actor_id, actor_role
      )
      select ${args.eventId}, inserted_order.id, null, 'pending', ${args.accountId}, 'member'
      from inserted_order
      returning id
    )
    select inserted_order.id
    from inserted_order
    cross join (select count(*) from inserted_items) item_count
    cross join (select count(*) from inserted_event) event_count
  `;
}
