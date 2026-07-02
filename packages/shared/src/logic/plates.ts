/** Plate calculator — pure. Visualized on a barbell graphic in Gym Mode. */

export const DEFAULT_BAR_KG = 20;
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export interface PlateBreakdown {
  /** Plates PER SIDE, heaviest first. */
  perSide: number[];
  /** Weight that couldn't be loaded with available plates (per side, kg). */
  remainder: number;
  achievableKg: number;
}

export function platesFor(
  targetKg: number,
  barKg = DEFAULT_BAR_KG,
  available: readonly number[] = PLATES_KG,
): PlateBreakdown {
  const perSideTarget = Math.max(0, (targetKg - barKg) / 2);
  let left = perSideTarget;
  const perSide: number[] = [];
  for (const p of [...available].sort((a, b) => b - a)) {
    while (left >= p - 1e-9) {
      perSide.push(p);
      left = Math.round((left - p) * 1000) / 1000;
    }
  }
  const loaded = perSide.reduce((s, p) => s + p, 0);
  return {
    perSide,
    remainder: Math.round(left * 1000) / 1000,
    achievableKg: Math.round((barKg + loaded * 2) * 100) / 100,
  };
}
