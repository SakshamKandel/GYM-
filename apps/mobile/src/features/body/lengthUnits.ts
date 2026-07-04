import type { UnitPref } from '@gym/shared';

/**
 * Tape lengths follow the same rule as body weight: canonical storage is
 * ALWAYS cm, converted only at the display edge (kg users see cm, lb users
 * see inches). Mirrors @gym/shared units.ts, local to features/body.
 */

const CM_PER_IN = 2.54;

export function cmToIn(cm: number): number {
  return Math.round((cm / CM_PER_IN) * 10) / 10;
}

export function inToCm(inches: number): number {
  return Math.round(inches * CM_PER_IN * 10) / 10;
}

/** Canonical cm → the number to render for this user. */
export function displayLength(cm: number, pref: UnitPref): number {
  return pref === 'kg' ? Math.round(cm * 10) / 10 : cmToIn(cm);
}

/** Stepper input in the user's unit → canonical cm for storage. */
export function lengthInputToCm(value: number, pref: UnitPref): number {
  return pref === 'kg' ? value : inToCm(value);
}

export function lengthUnitLabel(pref: UnitPref): 'cm' | 'in' {
  return pref === 'kg' ? 'cm' : 'in';
}
