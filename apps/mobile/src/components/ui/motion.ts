import { Easing, FadeIn, FadeInDown, FadeInUp, LinearTransition } from 'react-native-reanimated';

/**
 * Standard motion presets — one vocabulary app-wide so screens feel coherent.
 * 120–260ms, ease-out, transform/opacity only. Nothing loops or pulses.
 *
 * Usage: <Animated.View entering={enterUp(1)}> where the index staggers rows.
 */

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** Content block sliding up into place. Pass an index to stagger (55ms apart). */
export function enterUp(index = 0) {
  return FadeInDown.duration(320)
    .delay(index * 55)
    .easing(EASE_OUT);
}

/** Header/hero elements dropping in from above. */
export function enterDown(index = 0) {
  return FadeInUp.duration(300)
    .delay(index * 55)
    .easing(EASE_OUT);
}

/** Plain fade for swapped content (chip section switches, timer↔editor). */
export function enterFade(index = 0) {
  return FadeIn.duration(220)
    .delay(index * 45)
    .easing(EASE_OUT);
}

/** Layout transition for rows appearing/disappearing in lists. */
export const layoutSpring = LinearTransition.springify().damping(18).stiffness(180);
