import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Client-generated key for one logical checkout submission. */
export const mealOrderRequestIdSchema = z.string().uuid();

export interface MealOrderFingerprintInput {
  partnerId: string;
  deliveryDate: string;
  window: 'lunch' | 'dinner';
  addressId: string;
  items: readonly { mealId: string; qty: number }[];
  paymentMethod: 'esewa' | 'khalti' | 'cod';
  notes?: string;
}

/**
 * Hash the member-controlled order intent, excluding the request id itself.
 * Item order is not meaningful, so sorting prevents an equivalent retry from
 * conflicting merely because its JSON array was assembled in another order.
 */
export function mealOrderRequestFingerprint(input: MealOrderFingerprintInput): string {
  const items = input.items
    .map(({ mealId, qty }) => ({ mealId, qty }))
    .sort((a, b) => {
      if (a.mealId < b.mealId) return -1;
      if (a.mealId > b.mealId) return 1;
      return a.qty - b.qty;
    });

  const canonical = JSON.stringify({
    partnerId: input.partnerId,
    deliveryDate: input.deliveryDate,
    window: input.window,
    addressId: input.addressId,
    items,
    paymentMethod: input.paymentMethod,
    notes: input.notes?.trim() ?? '',
  });

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export type MealOrderIdempotencyResolution = 'create' | 'replay' | 'conflict';

/** Pure replay decision used both before insert and after a unique-key race. */
export function resolveMealOrderIdempotency(
  existing: { requestFingerprint: string | null } | null,
  requestFingerprint: string,
): MealOrderIdempotencyResolution {
  if (!existing) return 'create';
  return existing.requestFingerprint === requestFingerprint ? 'replay' : 'conflict';
}
