import type { UnitPref } from '../types';

/** Canonical storage is ALWAYS kg. Convert only at the display edge. */

const LB_PER_KG = 2.2046226218;

export function kgToLb(kg: number): number {
  return Math.round(kg * LB_PER_KG * 10) / 10;
}

export function lbToKg(lb: number): number {
  return Math.round((lb / LB_PER_KG) * 100) / 100;
}

export function displayWeight(kg: number, pref: UnitPref): number {
  return pref === 'kg' ? Math.round(kg * 10) / 10 : kgToLb(kg);
}

export function inputToKg(value: number, pref: UnitPref): number {
  return pref === 'kg' ? value : lbToKg(value);
}

export function unitLabel(pref: UnitPref): string {
  return pref;
}
