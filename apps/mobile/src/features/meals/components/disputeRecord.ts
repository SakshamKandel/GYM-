import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '../../../lib/mmkvStorage';
import type { MealDisputeReason } from '../api';

/**
 * A member's own record of the problems they have reported on meal orders.
 *
 * Filing a report used to vanish the instant the panel closed: the order looked
 * untouched, "Report a problem" invited a second one, and the only clue a case
 * existed was a 409 telling them to "check its status" on a screen that has
 * never existed. This is the honest half of the fix — the report the member
 * made, on the order they made it about, from the moment they send it.
 *
 * It is deliberately LOCAL. The server has no member-facing read for
 * `meal_disputes`, so this device knows what it filed and nothing more: the
 * OUTCOME arrives as a notification (the admin decision route messages the
 * member and writes an inbox row), which is what the copy points at. A
 * reinstall or a second phone starts empty rather than showing something
 * invented. The real fix is a dispute projection on the member order read;
 * see the followups.
 *
 * Lives beside the components (like orderView.ts) because it exists purely to
 * feed these order surfaces.
 */

export interface FiledDispute {
  reason: MealDisputeReason;
  /** ISO instant the member sent it, from this device's clock. */
  filedAt: string;
}

interface DisputeRecordState {
  /** orderId → the newest report this device filed for it. */
  byOrderId: Record<string, FiledDispute>;
  remember: (orderId: string, reason: MealDisputeReason) => void;
}

export const useFiledDisputes = create<DisputeRecordState>()(
  persist(
    (set) => ({
      byOrderId: {},
      remember: (orderId, reason) =>
        set((state) => ({
          byOrderId: {
            ...state.byOrderId,
            [orderId]: { reason, filedAt: new Date().toISOString() },
          },
        })),
    }),
    {
      name: 'gym-tracker-meal-disputes-v1',
      storage: createJSONStorage(() => mmkvStorage),
      // Only the records persist; `remember` is rebuilt on every launch.
      partialize: (s) => ({ byOrderId: s.byOrderId }),
    },
  ),
);
