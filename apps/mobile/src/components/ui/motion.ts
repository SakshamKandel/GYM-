import { Easing, FadeIn, LinearTransition } from 'react-native-reanimated';

/**
 * Standard motion presets — one vocabulary app-wide so screens feel coherent.
 * Owner direction: NO floating/sliding entrances anywhere — content appears
 * in place with a fast, quiet fade. Movement is reserved for user-driven
 * things (presses, drags, the sliding nav pill).
 */

const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);

/** Content block fading in place. Pass an index for a tiny stagger (30ms). */
export function enterUp(index = 0) {
  return FadeIn.duration(140)
    .delay(index * 30)
    .easing(EASE_OUT);
}

/** Header/hero elements — same quiet fade (kept as a separate name so
 * call sites keep reading naturally). */
export function enterDown(index = 0) {
  return FadeIn.duration(140)
    .delay(index * 30)
    .easing(EASE_OUT);
}

/** Swapped content (chip section switches, timer↔editor). */
export function enterFade(index = 0) {
  return FadeIn.duration(120)
    .delay(index * 25)
    .easing(EASE_OUT);
}

/** Rows appearing/disappearing in lists — quick settle, no spring bounce. */
export const layoutSpring = LinearTransition.duration(150).easing(EASE_OUT);
