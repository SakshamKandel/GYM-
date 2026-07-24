import { create } from 'zustand';
import type { MenuMeal } from './api';

/**
 * Ephemeral one-partner cart for the order flow (menu → checkout). Deliberately
 * NOT persisted — a half-built order is transient scratch state, not something
 * to survive an app restart (unlike the offline-first workout/nutrition logs).
 * Holding it in a tiny store instead of route params keeps the full MenuMeal
 * objects (macros, price) available on the checkout screen without re-fetching.
 */

interface CartLine {
  meal: MenuMeal;
  qty: number;
}

interface CartState {
  partnerId: string | null;
  lines: Record<string, CartLine>;
  setPartner: (partnerId: string) => void;
  setQty: (meal: MenuMeal, qty: number) => void;
  clear: () => void;
}

export const useMealCart = create<CartState>((set) => ({
  partnerId: null,
  lines: {},
  setPartner: (partnerId) =>
    set((s) => (s.partnerId === partnerId ? s : { partnerId, lines: {} })),
  setQty: (meal, qty) =>
    set((s) => {
      const next = { ...s.lines };
      if (qty <= 0) delete next[meal.id];
      else next[meal.id] = { meal, qty };
      return { lines: next };
    }),
  clear: () => set({ partnerId: null, lines: {} }),
}));

export function cartLineCount(lines: Record<string, CartLine>): number {
  return Object.values(lines).reduce((sum, l) => sum + l.qty, 0);
}

export function cartSubtotalMinor(lines: Record<string, CartLine>): number {
  return Object.values(lines).reduce((sum, l) => sum + l.meal.priceMinor * l.qty, 0);
}

export type { CartLine };
