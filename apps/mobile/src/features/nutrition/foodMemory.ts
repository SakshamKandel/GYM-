import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '../../lib/mmkvStorage';
import { clampPortionGrams } from './logic';

/**
 * The two things the food flow should never make a member say twice.
 *
 * 1. **The portion they actually eat.** Someone who logs 40 g of oats every
 *    morning had to dial 100 g down to 40 g every single morning, because the
 *    portion screen only ever knew the packet's serving size. The last portion
 *    per food is remembered and preselected.
 * 2. **A barcode nothing knows.** A product missing from Open Food Facts and
 *    USDA used to dead-end on every scan, so members created the same food
 *    over and over. The miss is remembered against the barcode along with the
 *    food they made for it.
 *
 * Deliberately NOT repo data: this is a convenience cache, never synced and
 * never authoritative. Every read degrades safely — a stale portion is only a
 * preselected number, and a remembered food id that no longer resolves simply
 * falls through to the normal lookup.
 */

const STORAGE_KEY = 'gym-tracker-food-memory-v1';

/** Bounds so a heavy logger's cache can't grow without end. Oldest go first. */
const MAX_PORTIONS = 300;
const MAX_BARCODES = 200;

interface FoodMemoryState {
  /** foodId → grams last logged for that food. */
  lastPortion: Record<string, number>;
  /**
   * barcode → the id of the custom food made for it, or null when the scan
   * missed and nothing was created (yet).
   */
  barcodeMisses: Record<string, string | null>;
  rememberPortion: (foodId: string, grams: number) => void;
  rememberBarcodeMiss: (barcode: string) => void;
  rememberBarcodeFood: (barcode: string, foodId: string) => void;
}

/**
 * Set a key as the most recent entry and drop the oldest once the map is
 * full. Rebuilt rather than mutated so re-saving an existing key moves it to
 * the back of the queue instead of keeping its original position.
 */
function put<T>(
  map: Record<string, T>,
  key: string,
  value: T,
  max: number,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k !== key) next[k] = v;
  }
  next[key] = value;
  const keys = Object.keys(next);
  if (keys.length <= max) return next;
  const trimmed: Record<string, T> = {};
  for (const k of keys.slice(keys.length - max)) {
    const v = next[k];
    if (v !== undefined) trimmed[k] = v;
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Keep only well-formed entries — the blob on disk is never trusted. */
function sanitizePortions(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    out[key] = clampPortionGrams(value);
  }
  return out;
}

function sanitizeBarcodes(raw: unknown): Record<string, string | null> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    if (value === null) out[key] = null;
    else if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

export const useFoodMemory = create<FoodMemoryState>()(
  persist(
    (set) => ({
      lastPortion: {},
      barcodeMisses: {},
      rememberPortion: (foodId, grams) =>
        set((s) =>
          foodId
            ? {
                lastPortion: put(
                  s.lastPortion,
                  foodId,
                  clampPortionGrams(grams),
                  MAX_PORTIONS,
                ),
              }
            : s,
        ),
      rememberBarcodeMiss: (barcode) =>
        set((s) =>
          barcode
            ? {
                barcodeMisses: put(
                  s.barcodeMisses,
                  barcode,
                  s.barcodeMisses[barcode] ?? null,
                  MAX_BARCODES,
                ),
              }
            : s,
        ),
      rememberBarcodeFood: (barcode, foodId) =>
        set((s) =>
          barcode && foodId
            ? { barcodeMisses: put(s.barcodeMisses, barcode, foodId, MAX_BARCODES) }
            : s,
        ),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (s) => ({ lastPortion: s.lastPortion, barcodeMisses: s.barcodeMisses }),
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current;
        return {
          ...current,
          lastPortion: sanitizePortions(persisted['lastPortion']),
          barcodeMisses: sanitizeBarcodes(persisted['barcodeMisses']),
        };
      },
    },
  ),
);

/** The portion this food was last logged at, or null if it's a first time. */
export function rememberedPortion(foodId: string): number | null {
  if (!foodId) return null;
  const grams = useFoodMemory.getState().lastPortion[foodId];
  return typeof grams === 'number' ? grams : null;
}

/** The custom food made for this barcode last time, if there was one. */
export function rememberedBarcodeFood(barcode: string): string | null {
  if (!barcode) return null;
  return useFoodMemory.getState().barcodeMisses[barcode] ?? null;
}

/** Whether this exact barcode has come up empty before on this device. */
export function barcodeMissedBefore(barcode: string): boolean {
  if (!barcode) return false;
  return barcode in useFoodMemory.getState().barcodeMisses;
}
