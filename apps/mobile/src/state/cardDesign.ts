import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '../lib/mmkvStorage';
import type { CardDesignId } from '../features/subscription/components/cardDesigns';

/**
 * Membership-card design preference — which of the 10 card faces the member
 * has picked for their own card. Purely a local cosmetic choice (no server
 * involved), so it lives in its own tiny persisted slice.
 */
interface CardDesignState {
  designId: CardDesignId;
  setDesignId: (id: CardDesignId) => void;
}

export const useCardDesign = create<CardDesignState>()(
  persist(
    (set) => ({
      designId: 'brushed',
      setDesignId: (id) => set({ designId: id }),
    }),
    {
      name: 'gym-tracker-card-design-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
