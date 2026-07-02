/**
 * Design tokens — single source of truth (CLAUDE.md rule 7).
 * Language: soft charcoal surfaces, signal-red accent, rounded geometry,
 * friendly rounded sans for titles + condensed numerals for stats.
 * Matched to the user's reference: dark sport-training app, red active states,
 * colorful category tiles, floating pill nav. No glow, no gradients-as-decor.
 */

export const colors = {
  // Background & surfaces (charcoal ramp, never pure black)
  bg: '#131416',
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
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
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
