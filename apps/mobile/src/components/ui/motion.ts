import { Platform } from 'react-native';
import { Easing, FadeIn, LinearTransition } from 'react-native-reanimated';

/**
 * Standard motion presets — one vocabulary app-wide so screens feel coherent.
 * Owner direction: NO floating/sliding entrances anywhere — content appears
 * in place with a fast, quiet fade. Movement is reserved for user-driven
 * things (presses, drags, the sliding nav pill).
 *
 * Web: Reanimated entering/layout animations can leave elements stuck at
 * opacity 0 in the browser (dev preview + expo web), so entrances are
 * disabled there — content renders in place immediately.
 */

const WEB = Platform.OS === 'web';

const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);

/** Content block fading in place. Pass an index for a tiny stagger (30ms). */
export function enterUp(index = 0) {
  if (WEB) return undefined;
  return FadeIn.duration(140)
    .delay(index * 30)
    .easing(EASE_OUT);
}

/** Header/hero elements — same quiet fade (kept as a separate name so
 * call sites keep reading naturally). */
export function enterDown(index = 0) {
  if (WEB) return undefined;
  return FadeIn.duration(140)
    .delay(index * 30)
    .easing(EASE_OUT);
}

/** Swapped content (chip section switches, timer↔editor). */
export function enterFade(index = 0) {
  if (WEB) return undefined;
  return FadeIn.duration(120)
    .delay(index * 25)
    .easing(EASE_OUT);
}

/** Rows appearing/disappearing in lists — quick settle, no spring bounce. */
export const layoutSpring = WEB
  ? undefined
  : LinearTransition.duration(150).easing(EASE_OUT);

/**
 * Gate for DIRECT entering/exiting animations (FadeIn/FadeOut/Slide…) used
 * outside the presets above: Reanimated entrance/exit animations are flaky on
 * web (elements can stick at opacity 0), so they run on native only. Wrap
 * every direct `entering={...}` / `exiting={...}` value in this.
 */
export function nativeOnly<T>(anim: T): T | undefined {
  return WEB ? undefined : anim;
}

/**
 * Shared spring configs for user-driven MOVEMENT (presses, sheet slide-up).
 * These are the only kind of motion allowed to spring/slide — the user
 * initiated them. Exported so every surface springs with one feel.
 */

/** Scale-settle for presses / active-state pops (PressableScale family). */
export const PRESS_SPRING = { damping: 18, stiffness: 320, mass: 0.9 } as const;

/** Bottom-sheet panel riding up from the bottom on tap-open. */
export const SHEET_SPRING = { damping: 22, stiffness: 240, mass: 0.9 } as const;
