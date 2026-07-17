/**
 * Design tokens — single source of truth (CLAUDE.md rule 7).
 * Language (2026-07 revamp, see apps/mobile/REVAMP-BRIEF.md): near-black canvas,
 * large color-blocked cards with NO hairline borders — separation comes from
 * fill contrast. Two block colors carry the energy: signal red (`blockRed`)
 * for a screen's single hero block, warm paper cream (`blockCream`) for the
 * counterpoint block; everything else is charcoal with white text. BLACK text
 * (`onBlock`) on red/cream blocks; white text only on charcoal/black. Chunky
 * geometry (`radius.block` 26), oversized Oswald display titles
 * (`type.size.heroTitle` 48), pill chips, floating pill nav.
 * No glow, no pulsing, no gradients-as-decor.
 */

export const colors = {
  // Background & surfaces (near-black canvas, charcoal card ramp)
  bg: '#0B0C0D',
  surface: '#1D1F22',
  surfaceRaised: '#26282C',
  surfacePressed: '#2E3135',
  border: '#2E3135',
  borderStrong: '#3B3E44',

  // Text
  text: '#F5F6F7',
  textDim: '#9BA0A8',
  textFaint: '#63676E',

  // Brand accent — signal red: active tab, FAB, CTAs, "today", PRs.
  accent: '#FF3B30',
  onAccent: '#FFFFFF',
  accentDim: '#C22D24',
  /** Red at 16% for subtle fills (dots, tints). */
  accentFaint: '#3D1B18',

  // Color-block system (revamp): one red hero block + at most one cream
  // counterpoint block per screen; the rest stay charcoal (`surface`).
  /** Hero-block fill — alias of `accent`. Black text on top (`onBlock`). */
  blockRed: '#FF3B30',
  /**
   * Lighter warm-red highlight for decorative red-on-red motifs on the hero
   * block (energy glow, arcs). ONLY lighter-than-blockRed tints go here — a
   * highlight lightens the surface, so black `onBlock` ink stays ≥4.5:1 even
   * where a motif sits under text (a darker tint would drop it, so never).
   */
  blockRedGlow: '#FF7A6E',
  /** Warm paper-cream counterpoint block. Black text on top (`onBlock`). */
  blockCream: '#F4F2ED',
  /** Text/icons on `blockRed` and `blockCream` (near-black, matches `bg`). */
  onBlock: '#0B0C0D',
  /** Secondary/dim text on `blockCream`. */
  creamDim: '#5C5A55',

  // Category palette (reference tiles: red / blue / orange)
  blue: '#4A8CFF',
  onBlue: '#FFFFFF',
  blueDeep: '#2F6BE0',
  orange: '#FF8A34',
  onOrange: '#1A1204',
  orangeDeep: '#E06E1C',

  // Semantic
  success: '#34C759',
  warning: '#FF9F0A',
  error: '#FF453A',

  // Macro colors (fixed meanings app-wide)
  kcal: '#FF3B30',
  protein: '#4A8CFF',
  carbs: '#FF8A34',
  fat: '#FFC53D',
  water: '#5AC8FA',

  // Interactive anatomy: warm neutral skin keeps the body human without
  // assuming a literal complexion; deep muscle tissue sits beneath the brand
  // red selection highlight.
  anatomySkin: '#9A7B6A',
  anatomyMuscle: '#70433D',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  /** Screen gutter & color-block inner padding (revamp rhythm). */
  gutter: 20,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  /** Color-block cards (revamp): chunky sticker-like blocks. */
  block: 26,
  full: 999,
} as const;

/**
 * Type pairing (reference): rounded geometric sans for titles/body (Poppins),
 * condensed caps for stat numbers, dates and micro-labels (Oswald).
 */
export const type = {
  display: 'Oswald_500Medium',
  displayLight: 'Oswald_400Regular',
  body: 'Poppins_400Regular',
  bodyMedium: 'Poppins_500Medium',
  bodySemiBold: 'Poppins_600SemiBold',
  bodyBold: 'Poppins_700Bold',

  size: {
    caption: 13,
    body: 16, // hard floor for reading text
    bodyLg: 18,
    title: 20,
    heading: 34, // big friendly screen title, sentence case
    display: 40,
    heroTitle: 48, // oversized Oswald screen title (revamp header pattern)
    stat: 56, // weight/kcal/timer numbers
    statHuge: 76, // gym mode / hero stats
  },
} as const;

/** Minimum touch target (dp). Primary buttons ≥ 56. */
export const touch = {
  min: 48,
  primary: 56,
} as const;

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
